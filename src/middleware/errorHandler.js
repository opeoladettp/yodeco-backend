// Global error handling middleware
const { securityLogger } = require('../utils/securityLogger');
const { getAllCircuitBreakerStates } = require('../utils/circuitBreaker');

// Error classification for better handling
const ERROR_CATEGORIES = {
  CLIENT_ERROR: 'CLIENT_ERROR',
  SERVER_ERROR: 'SERVER_ERROR',
  SECURITY_ERROR: 'SECURITY_ERROR',
  EXTERNAL_SERVICE_ERROR: 'EXTERNAL_SERVICE_ERROR',
  VALIDATION_ERROR: 'VALIDATION_ERROR'
};

// Error severity levels
const ERROR_SEVERITY = {
  LOW: 'LOW',
  MEDIUM: 'MEDIUM',
  HIGH: 'HIGH',
  CRITICAL: 'CRITICAL'
};

const errorHandler = (err, req, res, next) => {
  // Generate unique error ID for tracking
  const errorId = `err_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  
  // Enhanced error context
  const errorContext = {
    errorId,
    error: err.message,
    stack: process.env.NODE_ENV === 'development' ? err.stack : undefined,
    url: req.url,
    method: req.method,
    ip: req.ip,
    userAgent: req.get('User-Agent'),
    userId: req.user?.id,
    timestamp: new Date().toISOString(),
    requestId: req.headers['x-request-id'] || req.id,
    correlationId: req.headers['x-correlation-id'],
    userRole: req.user?.role,
    category: ERROR_CATEGORIES.SERVER_ERROR,
    severity: ERROR_SEVERITY.MEDIUM
  };
  
  console.error('Error occurred:', errorContext);

  // Default structured error response
  let error = {
    code: 'INTERNAL_SERVER_ERROR',
    message: 'Something went wrong!',
    retryable: true,
    timestamp: new Date().toISOString(),
    errorId,
    category: ERROR_CATEGORIES.SERVER_ERROR,
    severity: ERROR_SEVERITY.MEDIUM,
    supportInfo: {
      contactSupport: 'Please contact support if this issue persists',
      errorId: errorId
    }
  };

  // Mongoose validation error
  if (err.name === 'ValidationError') {
    const messages = Object.values(err.errors).map(val => val.message);
    errorContext.category = ERROR_CATEGORIES.VALIDATION_ERROR;
    errorContext.severity = ERROR_SEVERITY.LOW;
    
    error = {
      code: 'VALIDATION_ERROR',
      message: 'Validation failed',
      details: {
        fields: messages,
        invalidFields: Object.keys(err.errors)
      },
      retryable: false,
      timestamp: new Date().toISOString(),
      errorId,
      category: ERROR_CATEGORIES.VALIDATION_ERROR,
      severity: ERROR_SEVERITY.LOW,
      userAction: 'Please check your input and try again'
    };
    return res.status(400).json({ error });
  }

  // Mongoose duplicate key error
  if (err.code === 11000) {
    const field = Object.keys(err.keyValue)[0];
    const value = err.keyValue[field];
    errorContext.category = ERROR_CATEGORIES.CLIENT_ERROR;
    errorContext.severity = ERROR_SEVERITY.MEDIUM;
    
    // Handle specific duplicate vote scenario
    if (field === 'userId' && req.url.includes('/votes')) {
      error = {
        code: 'DUPLICATE_VOTE',
        message: 'You have already voted for this award',
        details: {
          field,
          value,
          existingVote: {
            timestamp: new Date().toISOString()
          }
        },
        retryable: false,
        timestamp: new Date().toISOString(),
        errorId,
        category: ERROR_CATEGORIES.CLIENT_ERROR,
        severity: ERROR_SEVERITY.MEDIUM,
        userAction: 'You can only vote once per award. Check your voting history to see your previous vote.'
      };
      return res.status(409).json({ error });
    }
    
    error = {
      code: 'DUPLICATE_ENTRY',
      message: `${field} already exists`,
      details: { field, value },
      retryable: false,
      timestamp: new Date().toISOString(),
      errorId,
      category: ERROR_CATEGORIES.CLIENT_ERROR,
      severity: ERROR_SEVERITY.LOW,
      userAction: `Please choose a different ${field}`
    };
    return res.status(409).json({ error });
  }

  // JWT errors
  if (err.name === 'JsonWebTokenError') {
    errorContext.category = ERROR_CATEGORIES.SECURITY_ERROR;
    errorContext.severity = ERROR_SEVERITY.HIGH;
    
    securityLogger.logSecurityEvent('INVALID_TOKEN_ATTEMPT', {
      ip: req.ip,
      userAgent: req.get('User-Agent'),
      url: req.url,
      errorId
    });
    
    error = {
      code: 'INVALID_TOKEN',
      message: 'Invalid authentication token',
      retryable: false,
      timestamp: new Date().toISOString(),
      errorId,
      category: ERROR_CATEGORIES.SECURITY_ERROR,
      severity: ERROR_SEVERITY.HIGH,
      userAction: 'Please sign in again'
    };
    return res.status(401).json({ error });
  }

  if (err.name === 'TokenExpiredError') {
    errorContext.category = ERROR_CATEGORIES.SECURITY_ERROR;
    errorContext.severity = ERROR_SEVERITY.MEDIUM;
    
    error = {
      code: 'TOKEN_EXPIRED',
      message: 'Authentication token has expired',
      retryable: false,
      timestamp: new Date().toISOString(),
      errorId,
      category: ERROR_CATEGORIES.SECURITY_ERROR,
      severity: ERROR_SEVERITY.MEDIUM,
      userAction: 'Please sign in again'
    };
    return res.status(401).json({ error });
  }

  // MongoDB connection errors
  if (err.name === 'MongoNetworkError' || err.name === 'MongoServerError') {
    errorContext.category = ERROR_CATEGORIES.EXTERNAL_SERVICE_ERROR;
    errorContext.severity = ERROR_SEVERITY.CRITICAL;
    
    error = {
      code: 'DATABASE_UNAVAILABLE',
      message: 'Database service temporarily unavailable',
      retryable: true,
      retryAfter: 30,
      timestamp: new Date().toISOString(),
      errorId,
      category: ERROR_CATEGORIES.EXTERNAL_SERVICE_ERROR,
      severity: ERROR_SEVERITY.CRITICAL,
      userAction: 'Please try again in a few moments',
      fallbackInfo: 'Some features may be limited while database is recovering'
    };
    res.set('Retry-After', '30');
    return res.status(503).json({ error });
  }

  // Redis connection errors
  if (err.code === 'ECONNREFUSED' && err.message.includes('redis')) {
    errorContext.category = ERROR_CATEGORIES.EXTERNAL_SERVICE_ERROR;
    errorContext.severity = ERROR_SEVERITY.HIGH;
    
    error = {
      code: 'CACHE_UNAVAILABLE',
      message: 'Cache service temporarily unavailable',
      retryable: true,
      retryAfter: 15,
      timestamp: new Date().toISOString(),
      errorId,
      category: ERROR_CATEGORIES.EXTERNAL_SERVICE_ERROR,
      severity: ERROR_SEVERITY.HIGH,
      userAction: 'Please try again in a few moments',
      fallbackInfo: 'System is operating with reduced performance'
    };
    res.set('Retry-After', '15');
    return res.status(503).json({ error });
  }

  // Rate limiting errors
  if (err.statusCode === 429) {
    errorContext.category = ERROR_CATEGORIES.CLIENT_ERROR;
    errorContext.severity = ERROR_SEVERITY.MEDIUM;
    
    error = {
      code: 'RATE_LIMIT_EXCEEDED',
      message: 'Too many requests, please try again later',
      retryable: true,
      retryAfter: err.retryAfter || 60,
      timestamp: new Date().toISOString(),
      errorId,
      category: ERROR_CATEGORIES.CLIENT_ERROR,
      severity: ERROR_SEVERITY.MEDIUM,
      userAction: `Please wait ${err.retryAfter || 60} seconds before trying again`
    };
    res.set('Retry-After', (err.retryAfter || 60).toString());
    return res.status(429).json({ error });
  }

  // Biometric verification errors
  if (err.code === 'BIOMETRIC_VERIFICATION_FAILED') {
    errorContext.category = ERROR_CATEGORIES.CLIENT_ERROR;
    errorContext.severity = ERROR_SEVERITY.MEDIUM;
    
    error = {
      code: 'BIOMETRIC_VERIFICATION_FAILED',
      message: 'Biometric verification failed',
      details: err.details || {},
      retryable: true,
      timestamp: new Date().toISOString(),
      errorId,
      category: ERROR_CATEGORIES.CLIENT_ERROR,
      severity: ERROR_SEVERITY.MEDIUM,
      userAction: 'Please try biometric verification again',
      fallbackInfo: 'Ensure your device supports biometric authentication'
    };
    return res.status(403).json({ error });
  }

  if (err.code === 'BIOMETRIC_VERIFICATION_REQUIRED') {
    errorContext.category = ERROR_CATEGORIES.CLIENT_ERROR;
    errorContext.severity = ERROR_SEVERITY.LOW;
    
    error = {
      code: 'BIOMETRIC_VERIFICATION_REQUIRED',
      message: 'Biometric verification required for this action',
      details: {
        instructions: 'Please complete biometric verification before proceeding',
        supportedMethods: ['Face ID', 'Touch ID', 'Windows Hello']
      },
      retryable: true,
      timestamp: new Date().toISOString(),
      errorId,
      category: ERROR_CATEGORIES.CLIENT_ERROR,
      severity: ERROR_SEVERITY.LOW,
      userAction: 'Complete biometric verification to continue'
    };
    return res.status(428).json({ error });
  }

  // File upload errors
  if (err.code === 'LIMIT_FILE_SIZE') {
    errorContext.category = ERROR_CATEGORIES.CLIENT_ERROR;
    errorContext.severity = ERROR_SEVERITY.LOW;
    
    error = {
      code: 'FILE_TOO_LARGE',
      message: 'File size exceeds maximum allowed limit',
      details: {
        maxSize: err.limit,
        receivedSize: err.received,
        maxSizeFormatted: `${Math.round(err.limit / 1024 / 1024)}MB`
      },
      retryable: false,
      timestamp: new Date().toISOString(),
      errorId,
      category: ERROR_CATEGORIES.CLIENT_ERROR,
      severity: ERROR_SEVERITY.LOW,
      userAction: `Please choose a file smaller than ${Math.round(err.limit / 1024 / 1024)}MB`
    };
    return res.status(413).json({ error });
  }

  if (err.code === 'LIMIT_UNEXPECTED_FILE') {
    errorContext.category = ERROR_CATEGORIES.CLIENT_ERROR;
    errorContext.severity = ERROR_SEVERITY.LOW;
    
    error = {
      code: 'INVALID_FILE_TYPE',
      message: 'Invalid file type uploaded',
      retryable: false,
      timestamp: new Date().toISOString(),
      errorId,
      category: ERROR_CATEGORIES.CLIENT_ERROR,
      severity: ERROR_SEVERITY.LOW,
      userAction: 'Please upload a valid image file (JPEG, PNG, WebP)',
      details: {
        allowedTypes: ['image/jpeg', 'image/png', 'image/webp']
      }
    };
    return res.status(400).json({ error });
  }

  // AWS S3 errors
  if (err.code === 'NoSuchBucket' || err.code === 'AccessDenied') {
    errorContext.category = ERROR_CATEGORIES.EXTERNAL_SERVICE_ERROR;
    errorContext.severity = ERROR_SEVERITY.HIGH;
    
    error = {
      code: 'STORAGE_SERVICE_ERROR',
      message: 'Storage service temporarily unavailable',
      retryable: true,
      retryAfter: 30,
      timestamp: new Date().toISOString(),
      errorId,
      category: ERROR_CATEGORIES.EXTERNAL_SERVICE_ERROR,
      severity: ERROR_SEVERITY.HIGH,
      userAction: 'Please try uploading your file again in a few moments'
    };
    res.set('Retry-After', '30');
    return res.status(503).json({ error });
  }

  // Custom application errors
  if (err.statusCode) {
    errorContext.category = err.category || ERROR_CATEGORIES.SERVER_ERROR;
    errorContext.severity = err.severity || ERROR_SEVERITY.MEDIUM;
    
    error = {
      code: err.code || 'APPLICATION_ERROR',
      message: err.message,
      details: err.details || {},
      retryable: err.retryable !== undefined ? err.retryable : false,
      timestamp: new Date().toISOString(),
      errorId,
      category: errorContext.category,
      severity: errorContext.severity,
      userAction: err.userAction || 'Please try again or contact support'
    };
    
    // Add retry-after header for retryable errors
    if (error.retryable && err.retryAfter) {
      res.set('Retry-After', err.retryAfter.toString());
    }
    
    return res.status(err.statusCode).json({ error });
  }

  // Circuit breaker errors
  if (err.code === 'CIRCUIT_BREAKER_OPEN') {
    errorContext.category = ERROR_CATEGORIES.EXTERNAL_SERVICE_ERROR;
    errorContext.severity = ERROR_SEVERITY.HIGH;
    
    error = {
      code: 'SERVICE_UNAVAILABLE',
      message: 'Service temporarily unavailable due to high error rate',
      retryable: true,
      retryAfter: 60,
      timestamp: new Date().toISOString(),
      errorId,
      category: ERROR_CATEGORIES.EXTERNAL_SERVICE_ERROR,
      severity: ERROR_SEVERITY.HIGH,
      userAction: 'Please try again in a few minutes',
      fallbackInfo: 'System is recovering from service issues'
    };
    res.set('Retry-After', '60');
    return res.status(503).json({ error });
  }

  // Timeout errors
  if (err.code === 'ETIMEDOUT' || err.name === 'TimeoutError') {
    errorContext.category = ERROR_CATEGORIES.EXTERNAL_SERVICE_ERROR;
    errorContext.severity = ERROR_SEVERITY.MEDIUM;
    
    error = {
      code: 'REQUEST_TIMEOUT',
      message: 'Request timed out, please try again',
      retryable: true,
      retryAfter: 10,
      timestamp: new Date().toISOString(),
      errorId,
      category: ERROR_CATEGORIES.EXTERNAL_SERVICE_ERROR,
      severity: ERROR_SEVERITY.MEDIUM,
      userAction: 'Please try your request again'
    };
    res.set('Retry-After', '10');
    return res.status(408).json({ error });
  }

  // Log critical errors for monitoring
  if (errorContext.severity === ERROR_SEVERITY.CRITICAL) {
    console.error('CRITICAL ERROR:', {
      ...errorContext,
      circuitBreakerStates: getAllCircuitBreakerStates()
    });
  }

  // Default server error with enhanced information
  errorContext.category = ERROR_CATEGORIES.SERVER_ERROR;
  errorContext.severity = ERROR_SEVERITY.HIGH;
  
  error = {
    ...error,
    category: ERROR_CATEGORIES.SERVER_ERROR,
    severity: ERROR_SEVERITY.HIGH,
    userAction: 'Please try again or contact support if the issue persists'
  };
  
  res.status(500).json({ error });
};

module.exports = errorHandler;