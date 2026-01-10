const { getAllCircuitBreakerStates } = require('../utils/circuitBreaker');
const redisService = require('./redisService');
const mongoose = require('mongoose');
const logger = require('../utils/logger');

class MonitoringService {
  constructor() {
    this.metrics = {
      requests: {
        total: 0,
        successful: 0,
        failed: 0,
        byEndpoint: new Map(),
        byStatusCode: new Map()
      },
      votes: {
        total: 0,
        successful: 0,
        failed: 0,
        duplicates: 0,
        biometricFailures: 0,
        averageProcessingTime: 0,
        totalProcessingTime: 0
      },
      authentication: {
        logins: 0,
        tokenRotations: 0,
        tokenReuse: 0,
        familyRevocations: 0,
        failedLogins: 0
      },
      errors: {
        total: 0,
        byType: new Map(),
        critical: 0,
        warnings: 0
      },
      performance: {
        averageResponseTime: 0,
        totalResponseTime: 0,
        slowQueries: 0,
        memoryUsage: {
          rss: 0,
          heapUsed: 0,
          heapTotal: 0,
          external: 0
        }
      },
      database: {
        connections: 0,
        queries: 0,
        slowQueries: 0,
        errors: 0
      },
      cache: {
        hits: 0,
        misses: 0,
        errors: 0,
        fallbackUsed: 0
      }
    };

    this.alerts = [];
    this.thresholds = {
      responseTime: 5000, // 5 seconds
      errorRate: 0.15, // 15% (more lenient)
      memoryUsage: 0.95, // 95% of available memory (more lenient)
      slowQueryTime: 1000, // 1 second
      circuitBreakerFailures: 10
    };

    // Start periodic metrics collection
    this.startPeriodicCollection();
  }

  /**
   * Record a request metric
   */
  recordRequest(endpoint, statusCode, responseTime) {
    this.metrics.requests.total++;
    
    if (statusCode >= 200 && statusCode < 400) {
      this.metrics.requests.successful++;
    } else {
      this.metrics.requests.failed++;
    }

    // Track by endpoint
    const endpointCount = this.metrics.requests.byEndpoint.get(endpoint) || 0;
    this.metrics.requests.byEndpoint.set(endpoint, endpointCount + 1);

    // Track by status code
    const statusCount = this.metrics.requests.byStatusCode.get(statusCode) || 0;
    this.metrics.requests.byStatusCode.set(statusCode, statusCount + 1);

    // Update performance metrics
    this.metrics.performance.totalResponseTime += responseTime;
    this.metrics.performance.averageResponseTime = 
      this.metrics.performance.totalResponseTime / this.metrics.requests.total;

    // Check for slow responses
    if (responseTime > this.thresholds.responseTime) {
      this.recordAlert('SLOW_RESPONSE', `Slow response on ${endpoint}: ${responseTime}ms`);
    }

    // Check error rate (only alert if we have enough requests and rate is sustained)
    if (this.metrics.requests.total > 20) { // Only check after 20 requests
      const errorRate = this.metrics.requests.failed / this.metrics.requests.total;
      if (errorRate > this.thresholds.errorRate) {
        // Only alert if we haven't alerted recently for this issue
        const recentAlerts = this.alerts.filter(alert => 
          alert.type === 'HIGH_ERROR_RATE' && 
          (Date.now() - new Date(alert.timestamp).getTime()) < 60000 // 1 minute
        );
        
        if (recentAlerts.length === 0) {
          this.recordAlert('HIGH_ERROR_RATE', `Error rate exceeded threshold: ${(errorRate * 100).toFixed(2)}%`);
        }
      }
    }
  }

  /**
   * Record a vote operation metric
   */
  recordVote(success, processingTime, reason = null) {
    this.metrics.votes.total++;
    this.metrics.votes.totalProcessingTime += processingTime;
    this.metrics.votes.averageProcessingTime = 
      this.metrics.votes.totalProcessingTime / this.metrics.votes.total;

    if (success) {
      this.metrics.votes.successful++;
    } else {
      this.metrics.votes.failed++;
      
      if (reason === 'duplicate') {
        this.metrics.votes.duplicates++;
      } else if (reason === 'biometric_failure') {
        this.metrics.votes.biometricFailures++;
      }
    }

    // Alert on high vote failure rate
    const failureRate = this.metrics.votes.failed / this.metrics.votes.total;
    if (failureRate > 0.1 && this.metrics.votes.total > 10) { // 10% failure rate with at least 10 votes
      this.recordAlert('HIGH_VOTE_FAILURE_RATE', `Vote failure rate: ${(failureRate * 100).toFixed(2)}%`);
    }
  }

  /**
   * Record authentication metrics
   */
  recordAuthentication(type, success = true) {
    switch (type) {
      case 'login':
        if (success) {
          this.metrics.authentication.logins++;
        } else {
          this.metrics.authentication.failedLogins++;
        }
        break;
      case 'token_rotation':
        this.metrics.authentication.tokenRotations++;
        break;
      case 'token_reuse':
        this.metrics.authentication.tokenReuse++;
        this.recordAlert('SECURITY_INCIDENT', 'Token reuse detected');
        break;
      case 'family_revocation':
        this.metrics.authentication.familyRevocations++;
        this.recordAlert('SECURITY_INCIDENT', 'Token family revocation triggered');
        break;
    }
  }

  /**
   * Record error metrics
   */
  recordError(error, type = 'general', critical = false) {
    this.metrics.errors.total++;
    
    if (critical) {
      this.metrics.errors.critical++;
      this.recordAlert('CRITICAL_ERROR', error.message || error);
    } else {
      this.metrics.errors.warnings++;
    }

    const typeCount = this.metrics.errors.byType.get(type) || 0;
    this.metrics.errors.byType.set(type, typeCount + 1);

    logger.error('Monitoring service recorded error', { error, type, critical });
  }

  /**
   * Record database metrics
   */
  recordDatabaseOperation(type, duration, success = true) {
    this.metrics.database.queries++;
    
    if (!success) {
      this.metrics.database.errors++;
    }

    if (duration > this.thresholds.slowQueryTime) {
      this.metrics.database.slowQueries++;
      this.recordAlert('SLOW_QUERY', `Slow ${type} query: ${duration}ms`);
    }
  }

  /**
   * Record cache metrics
   */
  recordCacheOperation(type, success = true) {
    switch (type) {
      case 'hit':
        this.metrics.cache.hits++;
        break;
      case 'miss':
        this.metrics.cache.misses++;
        break;
      case 'error':
        this.metrics.cache.errors++;
        break;
      case 'fallback':
        this.metrics.cache.fallbackUsed++;
        break;
    }
  }

  /**
   * Record an alert
   */
  recordAlert(type, message, severity = 'warning') {
    const alert = {
      type,
      message,
      severity,
      timestamp: new Date().toISOString(),
      id: `${type}_${Date.now()}`
    };

    this.alerts.unshift(alert);
    
    // Keep only last 100 alerts
    if (this.alerts.length > 100) {
      this.alerts = this.alerts.slice(0, 100);
    }

    logger.warn('Alert recorded', alert);

    // For critical alerts, also log as error
    if (severity === 'critical') {
      logger.error('Critical alert', alert);
    }
  }

  /**
   * Get current metrics snapshot
   */
  getMetrics() {
    return {
      ...this.metrics,
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      circuitBreakers: getAllCircuitBreakerStates(),
      database: {
        ...this.metrics.database,
        connectionState: mongoose.connection.readyState,
        connectionName: mongoose.connection.name
      },
      redis: {
        ...this.metrics.cache,
        fallbackStatus: redisService.getFallbackStatus()
      }
    };
  }

  /**
   * Get recent alerts
   */
  getAlerts(limit = 50) {
    return this.alerts.slice(0, limit);
  }

  /**
   * Clear old alerts
   */
  clearOldAlerts(olderThanHours = 24) {
    const cutoff = new Date(Date.now() - (olderThanHours * 60 * 60 * 1000));
    this.alerts = this.alerts.filter(alert => new Date(alert.timestamp) > cutoff);
  }

  /**
   * Get system health summary
   */
  getHealthSummary() {
    const metrics = this.getMetrics();
    const criticalAlerts = this.alerts.filter(alert => alert.severity === 'critical').length;
    const recentAlerts = this.alerts.filter(alert => 
      new Date(alert.timestamp) > new Date(Date.now() - 5 * 60 * 1000) // Last 5 minutes
    ).length;

    const errorRate = metrics.requests.total > 0 ? 
      metrics.requests.failed / metrics.requests.total : 0;

    const voteFailureRate = metrics.votes.total > 0 ? 
      metrics.votes.failed / metrics.votes.total : 0;

    const memoryUsagePercent = metrics.memory.heapUsed / metrics.memory.heapTotal;

    return {
      overall: criticalAlerts === 0 && errorRate < this.thresholds.errorRate ? 'healthy' : 'degraded',
      components: {
        api: {
          status: errorRate < this.thresholds.errorRate ? 'healthy' : 'degraded',
          errorRate: (errorRate * 100).toFixed(2) + '%',
          averageResponseTime: metrics.performance.averageResponseTime.toFixed(2) + 'ms'
        },
        voting: {
          status: voteFailureRate < 0.1 ? 'healthy' : 'degraded',
          failureRate: (voteFailureRate * 100).toFixed(2) + '%',
          averageProcessingTime: metrics.votes.averageProcessingTime.toFixed(2) + 'ms'
        },
        database: {
          status: metrics.database.connectionState === 1 ? 'healthy' : 'unhealthy',
          slowQueries: metrics.database.slowQueries,
          errors: metrics.database.errors
        },
        cache: {
          status: metrics.redis.fallbackStatus ? 'degraded' : 'healthy',
          hitRate: metrics.cache.hits > 0 ? 
            ((metrics.cache.hits / (metrics.cache.hits + metrics.cache.misses)) * 100).toFixed(2) + '%' : 'N/A'
        },
        memory: {
          status: memoryUsagePercent < this.thresholds.memoryUsage ? 'healthy' : 'warning',
          usage: (memoryUsagePercent * 100).toFixed(2) + '%'
        }
      },
      alerts: {
        critical: criticalAlerts,
        recent: recentAlerts,
        total: this.alerts.length
      },
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Start periodic metrics collection
   */
  startPeriodicCollection() {
    // Collect memory metrics every 30 seconds
    setInterval(() => {
      const memUsage = process.memoryUsage();
      this.metrics.performance.memoryUsage = memUsage;

      // Check memory usage threshold (with rate limiting)
      const memoryUsagePercent = memUsage.heapUsed / memUsage.heapTotal;
      if (memoryUsagePercent > this.thresholds.memoryUsage) {
        // Only alert if we haven't alerted recently for memory usage
        const recentMemoryAlerts = this.alerts.filter(alert => 
          alert.type === 'HIGH_MEMORY_USAGE' && 
          (Date.now() - new Date(alert.timestamp).getTime()) < 300000 // 5 minutes
        );
        
        if (recentMemoryAlerts.length === 0) {
          this.recordAlert('HIGH_MEMORY_USAGE', 
            `Memory usage: ${(memoryUsagePercent * 100).toFixed(2)}%`, 'warning');
        }
      }
    }, 30000);

    // Clear old alerts every hour
    setInterval(() => {
      this.clearOldAlerts(24);
    }, 60 * 60 * 1000);

    // Check circuit breaker states every minute
    setInterval(() => {
      const circuitBreakers = getAllCircuitBreakerStates();
      const openBreakers = Object.entries(circuitBreakers)
        .filter(([name, state]) => state.state === 'OPEN');

      if (openBreakers.length > 0) {
        openBreakers.forEach(([name, state]) => {
          if (state.failures >= this.thresholds.circuitBreakerFailures) {
            this.recordAlert('CIRCUIT_BREAKER_OPEN', 
              `Circuit breaker ${name} is open with ${state.failures} failures`, 'warning');
          }
        });
      }
    }, 60000);
  }

  /**
   * Reset metrics (useful for testing)
   */
  reset() {
    this.metrics = {
      requests: {
        total: 0,
        successful: 0,
        failed: 0,
        byEndpoint: new Map(),
        byStatusCode: new Map()
      },
      votes: {
        total: 0,
        successful: 0,
        failed: 0,
        duplicates: 0,
        biometricFailures: 0,
        averageProcessingTime: 0,
        totalProcessingTime: 0
      },
      authentication: {
        logins: 0,
        tokenRotations: 0,
        tokenReuse: 0,
        familyRevocations: 0,
        failedLogins: 0
      },
      errors: {
        total: 0,
        byType: new Map(),
        critical: 0,
        warnings: 0
      },
      performance: {
        averageResponseTime: 0,
        totalResponseTime: 0,
        slowQueries: 0,
        memoryUsage: {
          rss: 0,
          heapUsed: 0,
          heapTotal: 0,
          external: 0
        }
      },
      database: {
        connections: 0,
        queries: 0,
        slowQueries: 0,
        errors: 0
      },
      cache: {
        hits: 0,
        misses: 0,
        errors: 0,
        fallbackUsed: 0
      }
    };
    this.alerts = [];
  }
}

// Create singleton instance
const monitoringService = new MonitoringService();

module.exports = monitoringService;
      