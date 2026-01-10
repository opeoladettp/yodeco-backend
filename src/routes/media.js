const express = require('express');
const router = express.Router();
const mediaService = require('../services/mediaService');
const { authenticate } = require('../middleware/auth');
const { requireRole, requireAnyRole } = require('../middleware/rbac');
const { validate } = require('../middleware/validation');
const Joi = require('joi');

// Validation schemas
const presignedUrlSchema = Joi.object({
  contentType: Joi.string().valid('image/jpeg', 'image/jpg', 'image/png', 'image/webp').required(),
  fileSize: Joi.number().integer().min(1).max(5 * 1024 * 1024).required(), // Max 5MB
  fileName: Joi.string().min(1).max(255).required()
});

const verifyUploadSchema = Joi.object({
  objectKey: Joi.string().required()
});

/**
 * Generate presigned URL for image upload
 * POST /api/media/presigned-upload
 * Requires: Panelist role
 */
router.post('/presigned-upload', 
  authenticate,
  requireAnyRole(['Panelist', 'System_Admin']),
  validate(presignedUrlSchema),
  async (req, res, next) => {
    try {
      const { contentType, fileSize, fileName } = req.body;
      const userId = req.user.id;

      const result = await mediaService.generatePresignedUploadUrl(userId, contentType, fileSize);

      res.json({
        success: true,
        data: {
          uploadUrl: result.uploadUrl,
          objectKey: result.objectKey,
          expiresIn: result.expiresIn,
          fileName
        }
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * Verify that an uploaded file exists and is accessible
 * POST /api/media/verify-upload
 * Requires: Panelist role
 */
router.post('/verify-upload',
  authenticate,
  requireAnyRole(['Panelist', 'System_Admin']),
  validate(verifyUploadSchema),
  async (req, res, next) => {
    try {
      const { objectKey } = req.body;

      const exists = await mediaService.verifyObjectExists(objectKey);
      
      if (!exists) {
        return res.status(404).json({
          success: false,
          error: {
            code: 'FILE_NOT_FOUND',
            message: 'Uploaded file not found in storage'
          }
        });
      }

      // Generate download URL for verification
      const downloadUrl = await mediaService.generatePresignedDownloadUrl(objectKey);

      res.json({
        success: true,
        data: {
          objectKey,
          downloadUrl,
          verified: true
        }
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * Validate uploaded image format and integrity
 * POST /api/media/validate-image
 * Requires: Panelist role
 */
router.post('/validate-image',
  authenticate,
  requireAnyRole(['Panelist', 'System_Admin']),
  validate(Joi.object({
    objectKey: Joi.string().required(),
    contentType: Joi.string().valid('image/jpeg', 'image/jpg', 'image/png', 'image/webp').required()
  })),
  async (req, res, next) => {
    try {
      const { objectKey, contentType } = req.body;

      const validation = await mediaService.validateUploadedImage(objectKey, contentType);

      if (!validation.valid) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'INVALID_IMAGE',
            message: validation.error,
            details: validation.details
          }
        });
      }

      // Generate optimized URLs for different use cases
      const urls = {
        original: mediaService.getOptimizedImageUrl(objectKey),
        thumbnail: mediaService.getOptimizedImageUrl(objectKey, { width: 150, height: 150, quality: 80 }),
        medium: mediaService.getOptimizedImageUrl(objectKey, { width: 400, height: 400, quality: 85 }),
        large: mediaService.getOptimizedImageUrl(objectKey, { width: 800, height: 800, quality: 90 })
      };

      res.json({
        success: true,
        data: {
          objectKey,
          valid: true,
          metadata: validation.metadata,
          urls
        }
      });
    } catch (error) {
      next(error);
    }
  }
);

/**
 * Get optimized image URL with transformations
 * GET /api/media/optimized/:objectKey
 * Public access with optional query parameters for transformations
 */
router.get('/optimized/*', async (req, res, next) => {
  try {
    // Extract object key from the path
    const objectKey = req.params[0];
    
    if (!objectKey) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'MISSING_OBJECT_KEY',
          message: 'Object key is required'
        }
      });
    }

    // Extract transformation options from query parameters
    const options = {};
    if (req.query.w) options.width = parseInt(req.query.w);
    if (req.query.h) options.height = parseInt(req.query.h);
    if (req.query.q) options.quality = parseInt(req.query.q);
    if (req.query.f) options.format = req.query.f;

    const optimizedUrl = mediaService.getOptimizedImageUrl(objectKey, options);

    // Redirect to the optimized image URL
    res.redirect(optimizedUrl);
  } catch (error) {
    next(error);
  }
});

/**
 * Get download URL for an image
 * GET /api/media/download/:objectKey
 * Public access for viewing images
 */
router.get('/download/*', async (req, res, next) => {
  try {
    // Extract object key from the path (everything after /download/)
    const objectKey = req.params[0];
    
    if (!objectKey) {
      return res.status(400).json({
        success: false,
        error: {
          code: 'MISSING_OBJECT_KEY',
          message: 'Object key is required'
        }
      });
    }

    const downloadUrl = await mediaService.generatePresignedDownloadUrl(objectKey);

    // Set CORS headers before redirecting
    res.set({
      'Access-Control-Allow-Origin': process.env.FRONTEND_URL || 'http://localhost:3000',
      'Access-Control-Allow-Methods': 'GET',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Cross-Origin-Resource-Policy': 'cross-origin'
    });

    // Redirect to the actual image URL
    res.redirect(downloadUrl);
  } catch (error) {
    next(error);
  }
});

/**
 * Delete an uploaded image
 * DELETE /api/media/:objectKey
 * Requires: Panelist role
 */
router.delete('/*',
  authenticate,
  requireAnyRole(['Panelist', 'System_Admin']),
  async (req, res, next) => {
    try {
      // Extract object key from the path
      const objectKey = req.params[0];
      
      if (!objectKey) {
        return res.status(400).json({
          success: false,
          error: {
            code: 'MISSING_OBJECT_KEY',
            message: 'Object key is required'
          }
        });
      }

      await mediaService.deleteObject(objectKey);

      res.json({
        success: true,
        message: 'Image deleted successfully'
      });
    } catch (error) {
      next(error);
    }
  }
);

module.exports = router;