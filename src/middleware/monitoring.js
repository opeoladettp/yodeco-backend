const monitoringService = require('../services/monitoringService');

/**
 * Middleware to track request metrics
 */
const requestMonitoring = (req, res, next) => {
  const startTime = Date.now();
  
  // Override res.end to capture response metrics
  const originalEnd = res.end;
  res.end = function(...args) {
    const responseTime = Date.now() - startTime;
    const endpoint = `${req.method} ${req.route?.path || req.path}`;
    
    // Record the request metrics
    try {
      monitoringService.recordRequest(endpoint, res.statusCode, responseTime);
    } catch (error) {
      // Don't let monitoring errors break the request
      console.warn('Failed to record request metrics:', error.message);
    }
    
    // Call original end method
    originalEnd.apply(this, args);
  };
  
  next();
};

/**
 * Middleware to track errors
 */
const errorMonitoring = (error, req, res, next) => {
  const endpoint = `${req.method} ${req.route?.path || req.path}`;
  const critical = res.statusCode >= 500;
  
  try {
    monitoringService.recordError(error, endpoint, critical);
  } catch (monitoringError) {
    // Don't let monitoring errors break the request
    console.warn('Failed to record error metrics:', monitoringError.message);
  }
  
  next(error);
};

/**
 * Middleware to track vote operations
 */
const voteMonitoring = {
  recordVoteAttempt: (req, res, next) => {
    req.voteStartTime = Date.now();
    next();
  },
  
  recordVoteResult: (success, reason = null) => {
    return (req, res, next) => {
      if (req.voteStartTime) {
        const processingTime = Date.now() - req.voteStartTime;
        try {
          monitoringService.recordVote(success, processingTime, reason);
        } catch (error) {
          console.warn('Failed to record vote metrics:', error.message);
        }
      }
      next();
    };
  }
};

/**
 * Middleware to track authentication operations
 */
const authMonitoring = {
  recordLogin: (success = true) => {
    return (req, res, next) => {
      try {
        monitoringService.recordAuthentication('login', success);
      } catch (error) {
        console.warn('Failed to record auth metrics:', error.message);
      }
      next();
    };
  },
  
  recordTokenRotation: (req, res, next) => {
    try {
      monitoringService.recordAuthentication('token_rotation');
    } catch (error) {
      console.warn('Failed to record auth metrics:', error.message);
    }
    next();
  },
  
  recordTokenReuse: (req, res, next) => {
    try {
      monitoringService.recordAuthentication('token_reuse');
    } catch (error) {
      console.warn('Failed to record auth metrics:', error.message);
    }
    next();
  },
  
  recordFamilyRevocation: (req, res, next) => {
    try {
      monitoringService.recordAuthentication('family_revocation');
    } catch (error) {
      console.warn('Failed to record auth metrics:', error.message);
    }
    next();
  }
};

/**
 * Middleware to track database operations
 */
const databaseMonitoring = {
  wrapQuery: (originalMethod, operationType) => {
    return function(...args) {
      const startTime = Date.now();
      const result = originalMethod.apply(this, args);
      
      // Handle both promises and callbacks
      if (result && typeof result.then === 'function') {
        return result
          .then(data => {
            const duration = Date.now() - startTime;
            try {
              monitoringService.recordDatabaseOperation(operationType, duration, true);
            } catch (error) {
              console.warn('Failed to record database metrics:', error.message);
            }
            return data;
          })
          .catch(error => {
            const duration = Date.now() - startTime;
            try {
              monitoringService.recordDatabaseOperation(operationType, duration, false);
            } catch (monitoringError) {
              console.warn('Failed to record database metrics:', monitoringError.message);
            }
            throw error;
          });
      }
      
      return result;
    };
  }
};

/**
 * Middleware to track cache operations
 */
const cacheMonitoring = {
  recordHit: (req, res, next) => {
    try {
      monitoringService.recordCacheOperation('hit');
    } catch (error) {
      console.warn('Failed to record cache metrics:', error.message);
    }
    next();
  },
  
  recordMiss: (req, res, next) => {
    try {
      monitoringService.recordCacheOperation('miss');
    } catch (error) {
      console.warn('Failed to record cache metrics:', error.message);
    }
    next();
  },
  
  recordError: (req, res, next) => {
    try {
      monitoringService.recordCacheOperation('error');
    } catch (error) {
      console.warn('Failed to record cache metrics:', error.message);
    }
    next();
  },
  
  recordFallback: (req, res, next) => {
    try {
      monitoringService.recordCacheOperation('fallback');
    } catch (error) {
      console.warn('Failed to record cache metrics:', error.message);
    }
    next();
  }
};

module.exports = {
  requestMonitoring,
  errorMonitoring,
  voteMonitoring,
  authMonitoring,
  databaseMonitoring,
  cacheMonitoring
};