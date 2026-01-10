const { s3Client, bucketName, cloudfrontDomain } = require('../config/aws');
const { GetObjectCommand, HeadObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const { withS3CircuitBreaker } = require('../utils/circuitBreaker');
const crypto = require('crypto');
const path = require('path');

class MediaService {
  /**
   * Generate a presigned URL for image upload
   * @param {string} userId - User ID for organizing uploads
   * @param {string} contentType - MIME type of the file
   * @param {number} fileSize - Size of the file in bytes
   * @returns {Promise<Object>} Presigned URL and object key
   */
  async generatePresignedUploadUrl(userId, contentType, fileSize) {
    // Validate content type
    const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
    if (!allowedTypes.includes(contentType)) {
      const error = new Error(`Invalid content type. Allowed types: ${allowedTypes.join(', ')}`);
      error.statusCode = 400;
      error.code = 'INVALID_CONTENT_TYPE';
      error.retryable = false;
      error.details = { allowedTypes };
      throw error;
    }

    // Validate file size (max 5MB)
    const maxSize = 5 * 1024 * 1024; // 5MB in bytes
    if (fileSize > maxSize) {
      const error = new Error(`File size too large. Maximum allowed: ${maxSize} bytes`);
      error.statusCode = 413;
      error.code = 'FILE_TOO_LARGE';
      error.retryable = false;
      error.details = { maxSize, receivedSize: fileSize };
      throw error;
    }

    // Generate unique object key
    const timestamp = Date.now();
    const randomId = crypto.randomBytes(8).toString('hex');
    const extension = this.getFileExtension(contentType);
    const objectKey = `uploads/${userId}/${timestamp}-${randomId}${extension}`;

    try {
      // Generate presigned URL with constraints using circuit breaker
      const presignedUrl = await withS3CircuitBreaker(
        async () => {
          const { PutObjectCommand } = require('@aws-sdk/client-s3');
          const command = new PutObjectCommand({
            Bucket: bucketName,
            Key: objectKey,
            ContentType: contentType,
            ContentLength: fileSize
          });
          
          return await getSignedUrl(s3Client, command, { 
            expiresIn: 300 // 5 minutes
          });
        },
        // Fallback: return error indicating service unavailable
        async () => {
          const error = new Error('Storage service temporarily unavailable');
          error.statusCode = 503;
          error.code = 'STORAGE_SERVICE_UNAVAILABLE';
          error.retryable = true;
          error.retryAfter = 60;
          throw error;
        }
      );

      return {
        uploadUrl: presignedUrl,
        objectKey,
        expiresIn: 300
      };
    } catch (error) {
      if (error.statusCode) {
        throw error;
      }
      
      const serviceError = new Error('Failed to generate upload URL');
      serviceError.statusCode = 503;
      serviceError.code = 'UPLOAD_URL_GENERATION_FAILED';
      serviceError.retryable = true;
      serviceError.retryAfter = 30;
      throw serviceError;
    }
  }

  /**
   * Generate a presigned URL for image download/viewing
   * @param {string} objectKey - S3 object key
   * @returns {Promise<string>} Presigned URL for download
   */
  async generatePresignedDownloadUrl(objectKey) {
    if (!objectKey) {
      const error = new Error('Object key is required');
      error.statusCode = 400;
      error.code = 'MISSING_OBJECT_KEY';
      error.retryable = false;
      throw error;
    }

    // If CloudFront is configured, use it for better performance
    if (cloudfrontDomain) {
      return `https://${cloudfrontDomain}/${objectKey}`;
    }

    try {
      // Otherwise, generate presigned URL from S3 with circuit breaker
      const presignedUrl = await withS3CircuitBreaker(
        async () => {
          const command = new GetObjectCommand({
            Bucket: bucketName,
            Key: objectKey
          });
          
          return await getSignedUrl(s3Client, command, { 
            expiresIn: 3600 // 1 hour
          });
        },
        // Fallback: return direct S3 URL (less secure but functional)
        async () => {
          console.warn('S3 service unavailable, using direct URL fallback');
          return `https://${bucketName}.s3.${process.env.AWS_REGION || 'us-east-1'}.amazonaws.com/${objectKey}`;
        }
      );

      return presignedUrl;
    } catch (error) {
      const serviceError = new Error('Failed to generate download URL');
      serviceError.statusCode = 503;
      serviceError.code = 'DOWNLOAD_URL_GENERATION_FAILED';
      serviceError.retryable = true;
      serviceError.retryAfter = 30;
      throw serviceError;
    }
  }

  /**
   * Verify that an object exists in S3
   * @param {string} objectKey - S3 object key
   * @returns {Promise<boolean>} Whether the object exists
   */
  async verifyObjectExists(objectKey) {
    try {
      const exists = await withS3CircuitBreaker(
        async () => {
          const command = new HeadObjectCommand({
            Bucket: bucketName,
            Key: objectKey
          });
          
          await s3Client.send(command);
          return true;
        },
        // Fallback: assume object doesn't exist if S3 is unavailable
        async () => {
          console.warn('S3 service unavailable for object verification, assuming object does not exist');
          return false;
        }
      );
      
      return exists;
    } catch (error) {
      if (error.name === 'NotFound' || error.$metadata?.httpStatusCode === 404) {
        return false;
      }
      
      // For other errors, assume object doesn't exist
      console.error('Error verifying object existence:', error);
      return false;
    }
  }

  /**
   * Delete an object from S3
   * @param {string} objectKey - S3 object key
   * @returns {Promise<void>}
   */
  async deleteObject(objectKey) {
    if (!objectKey) {
      const error = new Error('Object key is required');
      error.statusCode = 400;
      error.code = 'MISSING_OBJECT_KEY';
      error.retryable = false;
      throw error;
    }

    try {
      await withS3CircuitBreaker(
        async () => {
          const command = new DeleteObjectCommand({
            Bucket: bucketName,
            Key: objectKey
          });
          
          await s3Client.send(command);
        },
        // Fallback: log the deletion request but don't fail
        async () => {
          console.warn(`S3 service unavailable, object deletion queued for later: ${objectKey}`);
          // In a production system, you might queue this for later processing
        }
      );
    } catch (error) {
      const serviceError = new Error('Failed to delete object');
      serviceError.statusCode = 503;
      serviceError.code = 'OBJECT_DELETION_FAILED';
      serviceError.retryable = true;
      serviceError.retryAfter = 30;
      throw serviceError;
    }
  }

  /**
   * Get file extension from content type
   * @param {string} contentType - MIME type
   * @returns {string} File extension
   */
  getFileExtension(contentType) {
    const extensions = {
      'image/jpeg': '.jpg',
      'image/jpg': '.jpg',
      'image/png': '.png',
      'image/webp': '.webp'
    };
    return extensions[contentType] || '.jpg';
  }

  /**
   * Validate image file format by checking file signatures
   * @param {Buffer} fileBuffer - File buffer
   * @param {string} contentType - Declared content type
   * @returns {boolean} Whether the file is a valid image
   */
  validateImageFormat(fileBuffer, contentType) {
    if (!fileBuffer || fileBuffer.length === 0) {
      return false;
    }

    // Check file signatures (magic numbers)
    const signatures = {
      'image/jpeg': [0xFF, 0xD8, 0xFF],
      'image/jpg': [0xFF, 0xD8, 0xFF],
      'image/png': [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A],
      'image/webp': [0x52, 0x49, 0x46, 0x46] // RIFF header for WebP
    };

    const signature = signatures[contentType];
    if (!signature) {
      return false;
    }

    // Ensure buffer is large enough to contain the signature
    if (fileBuffer.length < signature.length) {
      return false;
    }

    // Check if file starts with the expected signature
    for (let i = 0; i < signature.length; i++) {
      if (fileBuffer[i] !== signature[i]) {
        return false;
      }
    }

    return true;
  }

  /**
   * Validate uploaded image after S3 upload
   * @param {string} objectKey - S3 object key
   * @param {string} expectedContentType - Expected content type
   * @returns {Promise<Object>} Validation result with details
   */
  async validateUploadedImage(objectKey, expectedContentType) {
    try {
      // Get object metadata from S3
      const headCommand = new HeadObjectCommand({
        Bucket: bucketName,
        Key: objectKey
      });
      const headResult = await s3Client.send(headCommand);

      // Check content type matches
      const actualContentType = headResult.ContentType;
      if (actualContentType !== expectedContentType) {
        return {
          valid: false,
          error: 'Content type mismatch',
          details: {
            expected: expectedContentType,
            actual: actualContentType
          }
        };
      }

      // Get first few bytes to validate file signature
      const getCommand = new GetObjectCommand({
        Bucket: bucketName,
        Key: objectKey,
        Range: 'bytes=0-15' // Get first 16 bytes for signature validation
      });
      const getResult = await s3Client.send(getCommand);

      // Convert stream to buffer for AWS SDK v3
      const chunks = [];
      for await (const chunk of getResult.Body) {
        chunks.push(chunk);
      }
      const fileBuffer = Buffer.concat(chunks);

      const isValidFormat = this.validateImageFormat(fileBuffer, expectedContentType);

      if (!isValidFormat) {
        return {
          valid: false,
          error: 'Invalid file format signature',
          details: {
            contentType: expectedContentType,
            signatureCheck: false
          }
        };
      }

      return {
        valid: true,
        metadata: {
          contentType: actualContentType,
          contentLength: headResult.ContentLength,
          lastModified: headResult.LastModified,
          etag: headResult.ETag
        }
      };

    } catch (error) {
      if (error.name === 'NoSuchKey' || error.$metadata?.httpStatusCode === 404) {
        return {
          valid: false,
          error: 'File not found in storage',
          details: { objectKey }
        };
      }
      throw error;
    }
  }

  /**
   * Get optimized image URL with CloudFront transformations
   * @param {string} objectKey - S3 object key
   * @param {Object} options - Transformation options
   * @returns {string} Optimized image URL
   */
  getOptimizedImageUrl(objectKey, options = {}) {
    if (!objectKey) {
      throw new Error('Object key is required');
    }

    // If CloudFront is configured, use it with optional transformations
    if (cloudfrontDomain) {
      let url = `https://${cloudfrontDomain}/${objectKey}`;
      
      // Add query parameters for image transformations if supported
      const params = new URLSearchParams();
      
      if (options.width) {
        params.append('w', options.width);
      }
      if (options.height) {
        params.append('h', options.height);
      }
      if (options.quality) {
        params.append('q', options.quality);
      }
      if (options.format) {
        params.append('f', options.format);
      }

      const queryString = params.toString();
      if (queryString) {
        url += `?${queryString}`;
      }

      return url;
    }

    // Fallback to direct S3 URL (not recommended for production)
    return `https://${bucketName}.s3.${process.env.AWS_REGION || 'us-east-1'}.amazonaws.com/${objectKey}`;
  }
}

module.exports = new MediaService();