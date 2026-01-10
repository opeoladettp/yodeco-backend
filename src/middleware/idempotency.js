const redisService = require('../services/redisService');
const crypto = require('crypto');

/**
 * Idempotency middleware to prevent duplicate requests
 * Uses Redis to store request results with TTL
 */

// Default configuration
const DEFAULT_CONFIG = {
  ttlSeconds: 24 * 60 * 60, // 24 hours
  headerName: 'Idempotency-Key',
  keyPrefix: 'idempotency',
  generateKey: false, // Whether to generate key if not provided
  skipMethods: ['GET', 'HEAD', 'OPTIONS'], // Methods to skip idempotency check
  skipSuccessOnly: false, // Only store successful responses
  maxKeyLength: 255,
  minKeyLength: 16
};

/**
 * Create idempotency middleware
 * @param {Object} options - Idempotency configuration
 * @param {number} options.ttlSeconds - TTL for stored responses in seconds
 * @param {string} options.headerName - Header name for idempotency key
 * @param {string} options.keyPrefix - Redis key prefix
 * @param {boolean} options.generateKey - Generate key if not provided
 * @param {Array} options.skipMethods - HTTP methods to skip
 * @param {boolean} options.skipSuccessOnly - Only store successful responses
 * @param {number} options.maxKeyLength - Maximum key length
 * @param {number} options.minKeyLength - Minimum key length
 * @returns {Function} Express middleware function
 */
function createIdempotencyMiddleware(options = {}) {
  const config = {
    ...DEFAULT_CONFIG,
    ...options
  };

  return async (req, res, next) => {
    try {
      // Skip for certain HTTP methods
      if (config.skipMethods.includes(req.method)) {
        return next();
      }

      // Get idempotency key from header
      let idempotencyKey = req.get(config.headerName);

      // Generate key if not provided and generation is enabled
      if (!idempotencyKey && config.generateKey) {
        idempotencyKey = generateIdempotencyKey(req);
        req.headers[config.headerName.toLowerCase()] = idempotencyKey;
      }

      // If no key and generation disabled, skip idempotency
      if (!idempotencyKey) {
        return next();
      }

      // Validate key format
      const validation = validateIdempotencyKey(idempotencyKey, config);
      if (!validation.valid) {
        return res.status(400).json({
          error: {
            code: 'INVALID_IDEMPOTENCY_KEY',
            message: validation.message,
            retryable: false
          }
        });
      }

      // Create Redis key
      const redisKey = createRedisKey(config.keyPrefix, req, idempotencyKey);

      // Check if request already processed
      const existingResponse = await getStoredResponse(redisKey);
      if (existingResponse) {
        // Return stored response
        return res.status(existingResponse.statusCode)
          .set(existingResponse.headers)
          .send(existingResponse.body);
      }

      // Store request info for processing
      req.idempotency = {
        key: idempotencyKey,
        redisKey,
        config
      };

      // Intercept response to store it
      interceptResponse(req, res, next);

    } catch (error) {
      console.error('Idempotency middleware error:', error);
      // On error, allow request to proceed (fail open)
      next();
    }
  };
}

/**
 * Generate idempotency key based on request
 * @param {Object} req - Express request object
 * @returns {string} Generated idempotency key
 */
function generateIdempotencyKey(req) {
  const userId = req.user?.id || req.user?._id || 'anonymous';
  const method = req.method;
  const path = req.path;
  const body = JSON.stringify(req.body || {});
  const timestamp = Date.now();
  
  const data = `${userId}:${method}:${path}:${body}:${timestamp}`;
  return crypto.createHash('sha256').update(data).digest('hex').substring(0, 32);
}

/**
 * Validate idempotency key format
 * @param {string} key - Idempotency key to validate
 * @param {Object} config - Configuration object
 * @returns {Object} Validation result
 */
function validateIdempotencyKey(key, config) {
  if (typeof key !== 'string') {
    return {
      valid: false,
      message: 'Idempotency key must be a string'
    };
  }

  if (key.length < config.minKeyLength) {
    return {
      valid: false,
      message: `Idempotency key must be at least ${config.minKeyLength} characters`
    };
  }

  if (key.length > config.maxKeyLength) {
    return {
      valid: false,
      message: `Idempotency key must be at most ${config.maxKeyLength} characters`
    };
  }

  // Check for valid characters (alphanumeric, hyphens, underscores)
  if (!/^[a-zA-Z0-9_-]+$/.test(key)) {
    return {
      valid: false,
      message: 'Idempotency key can only contain alphanumeric characters, hyphens, and underscores'
    };
  }

  return { valid: true };
}
/**
 * Create Redis key for idempotency
 * @param {string} prefix - Key prefix
 * @param {Object} req - Express request object
 * @param {string} idempotencyKey - Idempotency key
 * @returns {string} Redis key
 */
function createRedisKey(prefix, req, idempotencyKey) {
  const userId = req.user?.id || req.user?._id || 'anonymous';
  const method = req.method;
  const path = req.route?.path || req.path || 'unknown';
  
  return `${prefix}:${method}:${path}:${userId}:${idempotencyKey}`;
}

/**
 * Get stored response from Redis
 * @param {string} redisKey - Redis key
 * @returns {Object|null} Stored response or null
 */
async function getStoredResponse(redisKey) {
  try {
    const client = redisService.getClient();
    const stored = await client.get(redisKey);
    
    if (stored) {
      return JSON.parse(stored);
    }
    
    return null;
  } catch (error) {
    console.error('Error getting stored response:', error);
    return null;
  }
}

/**
 * Store response in Redis
 * @param {string} redisKey - Redis key
 * @param {Object} responseData - Response data to store
 * @param {number} ttlSeconds - TTL in seconds
 * @returns {boolean} Success status
 */
async function storeResponse(redisKey, responseData, ttlSeconds) {
  try {
    const client = redisService.getClient();
    await client.setEx(redisKey, ttlSeconds, JSON.stringify(responseData));
    return true;
  } catch (error) {
    console.error('Error storing response:', error);
    return false;
  }
}

/**
 * Intercept response to store it for idempotency
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Function} next - Next middleware function
 */
function interceptResponse(req, res, next) {
  const originalSend = res.send;
  const originalJson = res.json;
  const originalEnd = res.end;

  // Track if response has been sent
  let responseSent = false;

  // Override send method
  res.send = function(data) {
    if (!responseSent) {
      responseSent = true;
      handleResponseCapture(req, res, data);
    }
    return originalSend.call(this, data);
  };

  // Override json method
  res.json = function(data) {
    if (!responseSent) {
      responseSent = true;
      handleResponseCapture(req, res, data);
    }
    return originalJson.call(this, data);
  };

  // Override end method
  res.end = function(data) {
    if (!responseSent) {
      responseSent = true;
      handleResponseCapture(req, res, data);
    }
    return originalEnd.call(this, data);
  };

  next();
}

/**
 * Handle response capture for idempotency storage
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {*} data - Response data
 */
async function handleResponseCapture(req, res, data) {
  if (!req.idempotency) return;

  const { redisKey, config } = req.idempotency;
  const statusCode = res.statusCode;
  const isSuccess = statusCode >= 200 && statusCode < 300;

  // Skip storing if configured to only store successful responses
  if (config.skipSuccessOnly && !isSuccess) {
    return;
  }

  try {
    // Prepare response data for storage
    const responseData = {
      statusCode,
      headers: getStorableHeaders(res),
      body: data,
      timestamp: new Date().toISOString(),
      method: req.method,
      path: req.path
    };

    // Store response
    await storeResponse(redisKey, responseData, config.ttlSeconds);

  } catch (error) {
    console.error('Error capturing response for idempotency:', error);
  }
}

/**
 * Get headers that should be stored (exclude sensitive ones)
 * @param {Object} res - Express response object
 * @returns {Object} Filtered headers
 */
function getStorableHeaders(res) {
  const headers = res.getHeaders();
  const storableHeaders = {};

  // Headers to exclude from storage
  const excludeHeaders = [
    'set-cookie',
    'authorization',
    'x-powered-by',
    'server',
    'date',
    'connection',
    'keep-alive',
    'transfer-encoding'
  ];

  for (const [key, value] of Object.entries(headers)) {
    if (!excludeHeaders.includes(key.toLowerCase())) {
      storableHeaders[key] = value;
    }
  }

  return storableHeaders;
}

/**
 * Clear idempotency key from storage
 * @param {string} redisKey - Redis key to clear
 * @returns {boolean} Success status
 */
async function clearIdempotencyKey(redisKey) {
  try {
    const client = redisService.getClient();
    const result = await client.del(redisKey);
    return result > 0;
  } catch (error) {
    console.error('Error clearing idempotency key:', error);
    return false;
  }
}

/**
 * Get idempotency status for a key
 * @param {string} redisKey - Redis key
 * @returns {Object} Status information
 */
async function getIdempotencyStatus(redisKey) {
  try {
    const client = redisService.getClient();
    const exists = await client.exists(redisKey);
    const ttl = exists ? await client.ttl(redisKey) : -1;
    
    return {
      exists: exists === 1,
      ttl: ttl,
      expiresAt: ttl > 0 ? new Date(Date.now() + (ttl * 1000)).toISOString() : null
    };
  } catch (error) {
    console.error('Error getting idempotency status:', error);
    return {
      exists: false,
      ttl: -1,
      expiresAt: null
    };
  }
}
// Pre-configured idempotency middleware for different use cases

/**
 * Idempotency middleware for vote submission
 * Critical operations that must be idempotent
 */
const voteIdempotency = createIdempotencyMiddleware({
  ttlSeconds: 24 * 60 * 60, // 24 hours
  headerName: 'Idempotency-Key',
  keyPrefix: 'idempotency:vote',
  generateKey: false, // Require explicit key for votes
  skipSuccessOnly: false, // Store all responses
  minKeyLength: 16,
  maxKeyLength: 128
});

/**
 * Idempotency middleware for content management operations
 * Moderate TTL for content operations
 */
const contentIdempotency = createIdempotencyMiddleware({
  ttlSeconds: 12 * 60 * 60, // 12 hours
  headerName: 'Idempotency-Key',
  keyPrefix: 'idempotency:content',
  generateKey: true, // Auto-generate for content operations
  skipSuccessOnly: true, // Only store successful responses
  minKeyLength: 16,
  maxKeyLength: 128
});

/**
 * Idempotency middleware for user management operations
 * Administrative operations with longer TTL
 */
const adminIdempotency = createIdempotencyMiddleware({
  ttlSeconds: 48 * 60 * 60, // 48 hours
  headerName: 'Idempotency-Key',
  keyPrefix: 'idempotency:admin',
  generateKey: false, // Require explicit key for admin operations
  skipSuccessOnly: false, // Store all responses
  minKeyLength: 20,
  maxKeyLength: 128
});

/**
 * General idempotency middleware
 * For general API operations
 */
const generalIdempotency = createIdempotencyMiddleware({
  ttlSeconds: 6 * 60 * 60, // 6 hours
  headerName: 'Idempotency-Key',
  keyPrefix: 'idempotency:general',
  generateKey: true, // Auto-generate for convenience
  skipSuccessOnly: true, // Only store successful responses
  minKeyLength: 16,
  maxKeyLength: 128
});

/**
 * Create custom idempotency middleware
 * @param {Object} customConfig - Custom configuration
 * @returns {Function} Idempotency middleware
 */
function customIdempotency(customConfig) {
  return createIdempotencyMiddleware(customConfig);
}

/**
 * Middleware to require idempotency key
 * Returns 400 if no idempotency key is provided
 */
function requireIdempotencyKey(headerName = 'Idempotency-Key') {
  return (req, res, next) => {
    const idempotencyKey = req.get(headerName);
    
    if (!idempotencyKey) {
      return res.status(400).json({
        error: {
          code: 'IDEMPOTENCY_KEY_REQUIRED',
          message: `${headerName} header is required for this operation`,
          details: {
            headerName,
            example: 'a1b2c3d4-e5f6-7890-abcd-ef1234567890'
          },
          retryable: true
        }
      });
    }
    
    next();
  };
}

/**
 * Utility function to generate a UUID-like idempotency key
 * @returns {string} Generated key
 */
function generateUUIDKey() {
  return crypto.randomUUID();
}

/**
 * Utility function to generate a hash-based idempotency key
 * @param {string} data - Data to hash
 * @returns {string} Generated key
 */
function generateHashKey(data) {
  return crypto.createHash('sha256').update(data).digest('hex').substring(0, 32);
}

module.exports = {
  createIdempotencyMiddleware,
  voteIdempotency,
  contentIdempotency,
  adminIdempotency,
  generalIdempotency,
  customIdempotency,
  requireIdempotencyKey,
  clearIdempotencyKey,
  getIdempotencyStatus,
  generateUUIDKey,
  generateHashKey,
  DEFAULT_CONFIG
};