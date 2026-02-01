const redisService = require('../services/redisService');

/**
 * Rate limiting middleware using Redis sliding window
 * Supports different rate limits for different endpoints
 */

// Default rate limit configurations
const DEFAULT_LIMITS = {
  // Authentication endpoints - more lenient for testing
  auth: {
    windowMs: 15 * 60 * 1000, // 15 minutes
    maxRequests: 50, // 50 requests per 15 minutes (increased for testing)
    skipSuccessfulRequests: false,
    skipFailedRequests: false
  },
  
  // Vote submission - moderate limits
  vote: {
    windowMs: 60 * 1000, // 1 minute
    maxRequests: 5, // 5 votes per minute
    skipSuccessfulRequests: false,
    skipFailedRequests: false
  },
  
  // WebAuthn endpoints - moderate limits
  webauthn: {
    windowMs: 5 * 60 * 1000, // 5 minutes
    maxRequests: 20, // 20 requests per 5 minutes
    skipSuccessfulRequests: false,
    skipFailedRequests: false
  },
  
  // General API endpoints - lenient limits
  general: {
    windowMs: 60 * 1000, // 1 minute
    maxRequests: 100, // 100 requests per minute
    skipSuccessfulRequests: true,
    skipFailedRequests: false
  }
};

/**
 * Create rate limiting middleware with sliding window algorithm
 * @param {Object} options - Rate limiting options
 * @param {number} options.windowMs - Time window in milliseconds
 * @param {number} options.maxRequests - Maximum requests per window
 * @param {boolean} options.skipSuccessfulRequests - Skip counting successful requests
 * @param {boolean} options.skipFailedRequests - Skip counting failed requests
 * @param {Function} options.keyGenerator - Function to generate rate limit key
 * @param {Function} options.onLimitReached - Callback when limit is reached
 * @returns {Function} Express middleware function
 */
function createRateLimit(options = {}) {
  const config = {
    windowMs: options.windowMs || DEFAULT_LIMITS.general.windowMs,
    maxRequests: options.maxRequests || DEFAULT_LIMITS.general.maxRequests,
    skipSuccessfulRequests: options.skipSuccessfulRequests || false,
    skipFailedRequests: options.skipFailedRequests || false,
    keyGenerator: options.keyGenerator || defaultKeyGenerator,
    onLimitReached: options.onLimitReached || defaultOnLimitReached,
    message: options.message || 'Too many requests, please try again later'
  };

  return async (req, res, next) => {
    try {
      // Generate rate limit key
      const key = config.keyGenerator(req);
      
      // Check current rate limit status
      const result = await checkRateLimit(key, config.windowMs, config.maxRequests);
      
      // Add rate limit headers
      addRateLimitHeaders(res, result, config);
      
      // Check if limit exceeded
      if (result.exceeded) {
        // Call onLimitReached callback
        config.onLimitReached(req, res, result);
        
        return res.status(429).json({
          error: {
            code: 'RATE_LIMIT_EXCEEDED',
            message: config.message,
            details: {
              limit: config.maxRequests,
              windowMs: config.windowMs,
              remaining: result.remaining,
              resetTime: result.resetTime
            },
            retryable: true
          }
        });
      }
      
      // Store rate limit info for potential cleanup
      req.rateLimit = {
        key,
        config,
        result
      };
      
      next();
    } catch (error) {
      console.error('Rate limiting error:', error);
      // On error, allow request to proceed (fail open)
      next();
    }
  };
}
/**
 * Sliding window rate limiting implementation using Redis
 * @param {string} key - Rate limit key
 * @param {number} windowMs - Time window in milliseconds
 * @param {number} maxRequests - Maximum requests per window
 * @returns {Object} Rate limit result
 */
async function checkRateLimit(key, windowMs, maxRequests) {
  const client = redisService.getClient();
  const now = Date.now();
  const windowStart = now - windowMs;
  
  try {
    // Use Redis sorted set for sliding window
    // Remove expired entries (remove entries older than windowStart)
    await client.zRemRangeByScore(key, 0, windowStart);
    
    // Add current request - Redis v4+ syntax
    await client.zAdd(key, { score: now, value: `${now}-${Math.random()}` });
    
    // Count current requests in window
    const currentCount = await client.zCard(key);
    
    // Set expiration for cleanup
    await client.expire(key, Math.ceil(windowMs / 1000));
    
    const resetTime = new Date(now + windowMs);
    
    return {
      count: currentCount,
      remaining: Math.max(0, maxRequests - currentCount),
      exceeded: currentCount > maxRequests,
      resetTime: resetTime.toISOString(),
      windowMs
    };
  } catch (error) {
    console.error('Redis rate limit error:', error);
    // Fallback to simple counter if sorted sets fail
    return await simpleRateLimit(key, windowMs, maxRequests);
  }
}

/**
 * Simple rate limiting fallback using basic Redis operations
 * @param {string} key - Rate limit key
 * @param {number} windowMs - Time window in milliseconds
 * @param {number} maxRequests - Maximum requests per window
 * @returns {Object} Rate limit result
 */
async function simpleRateLimit(key, windowMs, maxRequests) {
  try {
    const client = redisService.getClient();
    const current = await client.incr(key);
    
    if (current === 1) {
      await client.pExpire(key, windowMs);
    }
    
    const resetTime = new Date(Date.now() + windowMs);
    
    return {
      count: current,
      remaining: Math.max(0, maxRequests - current),
      exceeded: current > maxRequests,
      resetTime: resetTime.toISOString(),
      windowMs
    };
  } catch (error) {
    console.error('Simple rate limit error:', error);
    // If all Redis operations fail, allow the request (fail open)
    return {
      count: 0,
      remaining: maxRequests,
      exceeded: false,
      resetTime: new Date(Date.now() + windowMs).toISOString(),
      windowMs
    };
  }
}

/**
 * Default key generator - uses IP address and user ID if available
 * @param {Object} req - Express request object
 * @returns {string} Rate limit key
 */
function defaultKeyGenerator(req) {
  const ip = req.ip || req.connection.remoteAddress || req.headers['x-forwarded-for'] || 'unknown';
  const userId = req.user?.id || req.user?._id || 'anonymous';
  const endpoint = req.route?.path || req.path || 'unknown';
  
  return `rate_limit:${ip}:${userId}:${endpoint}`;
}

/**
 * Default callback when rate limit is reached
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 * @param {Object} result - Rate limit result
 */
function defaultOnLimitReached(req, res, result) {
  console.warn('Rate limit exceeded:', {
    ip: req.ip,
    userId: req.user?.id,
    endpoint: req.path,
    count: result.count,
    limit: result.maxRequests
  });
}

/**
 * Add rate limit headers to response
 * @param {Object} res - Express response object
 * @param {Object} result - Rate limit result
 * @param {Object} config - Rate limit configuration
 */
function addRateLimitHeaders(res, result, config) {
  res.set({
    'X-RateLimit-Limit': config.maxRequests.toString(),
    'X-RateLimit-Remaining': result.remaining.toString(),
    'X-RateLimit-Reset': result.resetTime,
    'X-RateLimit-Window': config.windowMs.toString()
  });
  
  if (result.exceeded) {
    res.set('Retry-After', Math.ceil(config.windowMs / 1000).toString());
  }
}

/**
 * Middleware cleanup function to handle successful/failed requests
 * Should be called after request processing
 */
function rateLimitCleanup(req, res, next) {
  const originalSend = res.send;
  const originalJson = res.json;
  
  // Override send method to track response
  res.send = function(data) {
    handleResponseComplete(req, res);
    return originalSend.call(this, data);
  };
  
  // Override json method to track response
  res.json = function(data) {
    handleResponseComplete(req, res);
    return originalJson.call(this, data);
  };
  
  next();
}

/**
 * Handle response completion for rate limit cleanup
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
async function handleResponseComplete(req, res) {
  if (!req.rateLimit) return;
  
  const { key, config } = req.rateLimit;
  const isSuccess = res.statusCode >= 200 && res.statusCode < 400;
  const isError = res.statusCode >= 400;
  
  try {
    // Remove request from count if configured to skip
    if ((isSuccess && config.skipSuccessfulRequests) || 
        (isError && config.skipFailedRequests)) {
      
      const client = redisService.getClient();
      const now = Date.now();
      
      // Remove the most recent entry for this request
      // This is approximate but works for most cases
      await client.zRemRangeByScore(key, now - 1000, now);
    }
  } catch (error) {
    console.error('Rate limit cleanup error:', error);
  }
}
// Pre-configured rate limiters for different endpoint types

/**
 * Rate limiter for authentication endpoints
 * Strict limits to prevent brute force attacks
 */
const authRateLimit = (req, res, next) => {
  // Skip rate limiting in development
  if (process.env.NODE_ENV === 'development') {
    console.log('🔧 Development mode: Skipping auth rate limiting');
    return next();
  }
  
  // Apply rate limiting in production
  return createRateLimit({
    ...DEFAULT_LIMITS.auth,
    keyGenerator: (req) => {
      const ip = req.ip || req.connection.remoteAddress || 'unknown';
      return `rate_limit:auth:${ip}`;
    },
    message: 'Too many authentication attempts, please try again later',
    onLimitReached: (req, res, result) => {
      console.warn('Authentication rate limit exceeded:', {
        ip: req.ip,
        endpoint: req.path,
        count: result.count,
        userAgent: req.get('User-Agent')
      });
    }
  })(req, res, next);
};

/**
 * Rate limiter for vote submission endpoints
 * Moderate limits to prevent vote spam while allowing legitimate voting
 */
const voteRateLimit = createRateLimit({
  ...DEFAULT_LIMITS.vote,
  keyGenerator: (req) => {
    const userId = req.user?.id || req.user?._id || 'anonymous';
    const ip = req.ip || req.connection.remoteAddress || 'unknown';
    return `rate_limit:vote:${userId}:${ip}`;
  },
  message: 'Too many vote attempts, please wait before voting again',
  onLimitReached: (req, res, result) => {
    console.warn('Vote rate limit exceeded:', {
      userId: req.user?.id,
      ip: req.ip,
      endpoint: req.path,
      count: result.count
    });
  }
});

/**
 * Rate limiter for WebAuthn endpoints
 * Moderate limits for biometric operations
 */
const webauthnRateLimit = createRateLimit({
  ...DEFAULT_LIMITS.webauthn,
  keyGenerator: (req) => {
    const userId = req.user?.id || req.user?._id || 'anonymous';
    const ip = req.ip || req.connection.remoteAddress || 'unknown';
    return `rate_limit:webauthn:${userId}:${ip}`;
  },
  message: 'Too many biometric authentication attempts, please try again later',
  onLimitReached: (req, res, result) => {
    console.warn('WebAuthn rate limit exceeded:', {
      userId: req.user?.id,
      ip: req.ip,
      endpoint: req.path,
      count: result.count
    });
  }
});

/**
 * General rate limiter for other API endpoints
 * Lenient limits for general API usage
 */
const generalRateLimit = createRateLimit({
  ...DEFAULT_LIMITS.general,
  keyGenerator: (req) => {
    const userId = req.user?.id || req.user?._id || 'anonymous';
    const ip = req.ip || req.connection.remoteAddress || 'unknown';
    return `rate_limit:general:${userId}:${ip}`;
  },
  message: 'Too many requests, please slow down',
  skipSuccessfulRequests: true // Don't count successful requests for general endpoints
});

/**
 * Create custom rate limiter with specific configuration
 * @param {Object} customConfig - Custom rate limit configuration
 * @returns {Function} Rate limit middleware
 */
function customRateLimit(customConfig) {
  return createRateLimit(customConfig);
}

/**
 * Get rate limit status for a specific key
 * @param {string} key - Rate limit key
 * @param {number} windowMs - Time window in milliseconds
 * @param {number} maxRequests - Maximum requests per window
 * @returns {Object} Current rate limit status
 */
async function getRateLimitStatus(key, windowMs, maxRequests) {
  try {
    return await checkRateLimit(key, windowMs, maxRequests);
  } catch (error) {
    console.error('Error getting rate limit status:', error);
    return {
      count: 0,
      remaining: maxRequests,
      exceeded: false,
      resetTime: new Date(Date.now() + windowMs).toISOString(),
      windowMs
    };
  }
}

/**
 * Clear rate limit for a specific key
 * @param {string} key - Rate limit key to clear
 * @returns {boolean} Success status
 */
async function clearRateLimit(key) {
  try {
    const client = redisService.getClient();
    const result = await client.del(key);
    return result > 0;
  } catch (error) {
    console.error('Error clearing rate limit:', error);
    return false;
  }
}

module.exports = {
  createRateLimit,
  authRateLimit,
  voteRateLimit,
  webauthnRateLimit,
  generalRateLimit,
  customRateLimit,
  rateLimitCleanup,
  getRateLimitStatus,
  clearRateLimit,
  DEFAULT_LIMITS
};