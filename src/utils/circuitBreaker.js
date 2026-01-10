// Circuit breaker implementation for external services

class CircuitBreaker {
  constructor(options = {}) {
    this.failureThreshold = options.failureThreshold || 5;
    this.resetTimeout = options.resetTimeout || 60000; // 1 minute
    this.monitoringPeriod = options.monitoringPeriod || 10000; // 10 seconds
    this.expectedErrors = options.expectedErrors || [];
    
    this.state = 'CLOSED'; // CLOSED, OPEN, HALF_OPEN
    this.failureCount = 0;
    this.lastFailureTime = null;
    this.successCount = 0;
    this.requestCount = 0;
    
    // Statistics
    this.stats = {
      totalRequests: 0,
      totalFailures: 0,
      totalSuccesses: 0,
      lastReset: Date.now()
    };
  }

  async execute(operation, fallback = null) {
    this.stats.totalRequests++;
    this.requestCount++;

    if (this.state === 'OPEN') {
      if (this.shouldAttemptReset()) {
        this.state = 'HALF_OPEN';
        console.log('Circuit breaker transitioning to HALF_OPEN state');
      } else {
        const error = new Error('Circuit breaker is OPEN');
        error.code = 'CIRCUIT_BREAKER_OPEN';
        
        if (fallback) {
          console.log('Circuit breaker OPEN, executing fallback');
          return await fallback();
        }
        
        throw error;
      }
    }

    try {
      const result = await operation();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure(error);
      
      if (fallback && this.state === 'OPEN') {
        console.log('Circuit breaker OPEN after failure, executing fallback');
        return await fallback();
      }
      
      throw error;
    }
  }

  onSuccess() {
    this.failureCount = 0;
    this.successCount++;
    this.stats.totalSuccesses++;
    
    if (this.state === 'HALF_OPEN') {
      this.state = 'CLOSED';
      console.log('Circuit breaker reset to CLOSED state after successful request');
    }
  }

  onFailure(error) {
    this.failureCount++;
    this.stats.totalFailures++;
    this.lastFailureTime = Date.now();
    
    // Don't count expected errors towards circuit breaker
    if (this.isExpectedError(error)) {
      return;
    }
    
    if (this.failureCount >= this.failureThreshold) {
      this.state = 'OPEN';
      console.log(`Circuit breaker opened after ${this.failureCount} failures`);
    }
  }

  shouldAttemptReset() {
    return Date.now() - this.lastFailureTime >= this.resetTimeout;
  }

  isExpectedError(error) {
    return this.expectedErrors.some(expectedError => {
      if (typeof expectedError === 'string') {
        return error.code === expectedError || error.name === expectedError;
      }
      if (typeof expectedError === 'function') {
        return expectedError(error);
      }
      return false;
    });
  }

  getState() {
    return {
      state: this.state,
      failureCount: this.failureCount,
      successCount: this.successCount,
      requestCount: this.requestCount,
      lastFailureTime: this.lastFailureTime,
      stats: { ...this.stats }
    };
  }

  reset() {
    this.state = 'CLOSED';
    this.failureCount = 0;
    this.successCount = 0;
    this.requestCount = 0;
    this.lastFailureTime = null;
    console.log('Circuit breaker manually reset');
  }

  // Get health status for monitoring
  getHealthStatus() {
    const now = Date.now();
    const uptime = now - this.stats.lastReset;
    const failureRate = this.stats.totalRequests > 0 
      ? (this.stats.totalFailures / this.stats.totalRequests) * 100 
      : 0;

    return {
      state: this.state,
      healthy: this.state !== 'OPEN',
      failureRate: Math.round(failureRate * 100) / 100,
      totalRequests: this.stats.totalRequests,
      totalFailures: this.stats.totalFailures,
      totalSuccesses: this.stats.totalSuccesses,
      uptime,
      lastFailureTime: this.lastFailureTime
    };
  }
}

// Circuit breaker instances for different services
const circuitBreakers = {
  database: new CircuitBreaker({
    failureThreshold: 5,
    resetTimeout: 30000, // 30 seconds
    expectedErrors: ['ValidationError', 'CastError'] // Don't trip on validation errors
  }),
  
  redis: new CircuitBreaker({
    failureThreshold: 3,
    resetTimeout: 15000, // 15 seconds
    expectedErrors: []
  }),
  
  s3: new CircuitBreaker({
    failureThreshold: 5,
    resetTimeout: 60000, // 1 minute
    expectedErrors: ['NoSuchKey', 'InvalidRequest'] // Don't trip on client errors
  }),
  
  webauthn: new CircuitBreaker({
    failureThreshold: 10,
    resetTimeout: 30000, // 30 seconds
    expectedErrors: ['InvalidAssertion', 'UserCancelled'] // Don't trip on user errors
  })
};

// Wrapper functions for common operations
const withDatabaseCircuitBreaker = async (operation, fallback = null) => {
  return circuitBreakers.database.execute(operation, fallback);
};

const withRedisCircuitBreaker = async (operation, fallback = null) => {
  return circuitBreakers.redis.execute(operation, fallback);
};

const withS3CircuitBreaker = async (operation, fallback = null) => {
  return circuitBreakers.s3.execute(operation, fallback);
};

const withWebAuthnCircuitBreaker = async (operation, fallback = null) => {
  return circuitBreakers.webauthn.execute(operation, fallback);
};

// Get all circuit breaker states for monitoring
const getAllCircuitBreakerStates = () => {
  return Object.keys(circuitBreakers).reduce((states, name) => {
    states[name] = circuitBreakers[name].getHealthStatus();
    return states;
  }, {});
};

module.exports = {
  CircuitBreaker,
  circuitBreakers,
  withDatabaseCircuitBreaker,
  withRedisCircuitBreaker,
  withS3CircuitBreaker,
  withWebAuthnCircuitBreaker,
  getAllCircuitBreakerStates
};