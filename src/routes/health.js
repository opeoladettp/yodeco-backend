const express = require('express');
const mongoose = require('mongoose');
const redisService = require('../services/redisService');
const monitoringService = require('../services/monitoringService');
const { getAllCircuitBreakerStates } = require('../utils/circuitBreaker');
const { s3, bucketName } = require('../config/aws');
const { authenticate, requireRole, ROLES } = require('../middleware');

const router = express.Router();

/**
 * Basic health check endpoint
 * Returns 200 OK if the service is running
 */
router.get('/', (req, res) => {
  res.status(200).json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    service: 'biometric-voting-portal',
    version: process.env.npm_package_version || '1.0.0'
  });
});

/**
 * Detailed health check with dependency status
 * Checks MongoDB, Redis, and S3 connectivity
 */
router.get('/detailed', async (req, res) => {
  const healthCheck = {
    status: 'healthy',
    timestamp: new Date().toISOString(),
    service: 'biometric-voting-portal',
    version: process.env.npm_package_version || '1.0.0',
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    dependencies: {},
    circuitBreakers: getAllCircuitBreakerStates()
  };

  let overallHealthy = true;

  // Check MongoDB connection
  try {
    const mongoState = mongoose.connection.readyState;
    const mongoStatus = {
      0: 'disconnected',
      1: 'connected',
      2: 'connecting',
      3: 'disconnecting'
    };

    healthCheck.dependencies.mongodb = {
      status: mongoState === 1 ? 'healthy' : 'unhealthy',
      state: mongoStatus[mongoState] || 'unknown',
      host: mongoose.connection.host,
      name: mongoose.connection.name
    };

    if (mongoState !== 1) {
      overallHealthy = false;
    }
  } catch (error) {
    healthCheck.dependencies.mongodb = {
      status: 'unhealthy',
      error: error.message
    };
    overallHealthy = false;
  }

  // Check Redis connection
  try {
    await redisService.ping();
    healthCheck.dependencies.redis = {
      status: 'healthy',
      fallbackStatus: redisService.getFallbackStatus()
    };
  } catch (error) {
    healthCheck.dependencies.redis = {
      status: 'unhealthy',
      error: error.message,
      fallbackStatus: redisService.getFallbackStatus()
    };
    // Redis failure doesn't make the service unhealthy due to fallback mechanisms
  }

  // Check S3 connectivity
  try {
    await s3.headBucket({ Bucket: bucketName }).promise();
    healthCheck.dependencies.s3 = {
      status: 'healthy',
      bucket: bucketName,
      region: process.env.AWS_REGION || 'us-east-1'
    };
  } catch (error) {
    healthCheck.dependencies.s3 = {
      status: 'unhealthy',
      error: error.message,
      bucket: bucketName
    };
    // S3 failure doesn't make the service unhealthy due to circuit breaker
  }

  // Set overall status
  healthCheck.status = overallHealthy ? 'healthy' : 'unhealthy';

  // Return appropriate status code
  const statusCode = overallHealthy ? 200 : 503;
  res.status(statusCode).json(healthCheck);
});

/**
 * Readiness probe - checks if service is ready to accept traffic
 * More strict than liveness probe
 */
router.get('/ready', async (req, res) => {
  const readinessCheck = {
    status: 'ready',
    timestamp: new Date().toISOString(),
    checks: {}
  };

  let ready = true;

  // Check critical dependencies
  try {
    // MongoDB must be connected
    if (mongoose.connection.readyState !== 1) {
      readinessCheck.checks.mongodb = {
        status: 'not_ready',
        reason: 'Database not connected'
      };
      ready = false;
    } else {
      readinessCheck.checks.mongodb = { status: 'ready' };
    }

    // Check if we can perform basic operations
    const User = require('../models/User');
    await User.countDocuments().limit(1);
    readinessCheck.checks.database_operations = { status: 'ready' };

  } catch (error) {
    readinessCheck.checks.database_operations = {
      status: 'not_ready',
      error: error.message
    };
    ready = false;
  }

  // Check circuit breaker states
  const circuitBreakers = getAllCircuitBreakerStates();
  const openBreakers = Object.entries(circuitBreakers)
    .filter(([name, state]) => state.state === 'OPEN')
    .map(([name]) => name);

  if (openBreakers.length > 0) {
    readinessCheck.checks.circuit_breakers = {
      status: 'degraded',
      open_breakers: openBreakers
    };
    // Don't mark as not ready for open circuit breakers, just degraded
  } else {
    readinessCheck.checks.circuit_breakers = { status: 'ready' };
  }

  readinessCheck.status = ready ? 'ready' : 'not_ready';
  const statusCode = ready ? 200 : 503;
  
  res.status(statusCode).json(readinessCheck);
});

/**
 * Liveness probe - checks if service is alive
 * Should be lightweight and not check external dependencies
 */
router.get('/live', (req, res) => {
  const livenessCheck = {
    status: 'alive',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    pid: process.pid
  };

  // Basic checks that don't depend on external services
  try {
    // Check if we can allocate memory
    const testArray = new Array(1000).fill(0);
    livenessCheck.memory_test = 'passed';

    // Check if event loop is responsive
    const start = Date.now();
    setImmediate(() => {
      const delay = Date.now() - start;
      livenessCheck.event_loop_delay = `${delay}ms`;
    });

    res.status(200).json(livenessCheck);
  } catch (error) {
    res.status(503).json({
      status: 'not_alive',
      timestamp: new Date().toISOString(),
      error: error.message
    });
  }
});

/**
 * Metrics endpoint for monitoring
 * Returns application metrics in a format suitable for monitoring systems
 */
router.get('/metrics', async (req, res) => {
  const metrics = {
    timestamp: new Date().toISOString(),
    service: 'biometric-voting-portal',
    system: {
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      cpu: process.cpuUsage(),
      platform: process.platform,
      nodeVersion: process.version
    },
    circuitBreakers: getAllCircuitBreakerStates(),
    redis: {
      fallbackStatus: redisService.getFallbackStatus()
    }
  };

  // Add database metrics if available
  try {
    if (mongoose.connection.readyState === 1) {
      const db = mongoose.connection.db;
      const stats = await db.stats();
      metrics.database = {
        collections: stats.collections,
        dataSize: stats.dataSize,
        indexSize: stats.indexSize,
        storageSize: stats.storageSize
      };
    }
  } catch (error) {
    metrics.database = { error: error.message };
  }

  res.status(200).json(metrics);
});

/**
 * Application metrics endpoint
 * Returns detailed application-specific metrics
 */
router.get('/app-metrics', authenticate, requireRole(ROLES.SYSTEM_ADMIN), (req, res) => {
  const metrics = monitoringService.getMetrics();
  res.status(200).json(metrics);
});

/**
 * Health summary endpoint
 * Returns a high-level health summary
 */
router.get('/summary', authenticate, requireRole(ROLES.SYSTEM_ADMIN), (req, res) => {
  const summary = monitoringService.getHealthSummary();
  res.status(200).json(summary);
});

/**
 * Alerts endpoint
 * Returns recent system alerts
 */
router.get('/alerts', authenticate, requireRole(ROLES.SYSTEM_ADMIN), (req, res) => {
  const limit = parseInt(req.query.limit) || 50;
  const alerts = monitoringService.getAlerts(limit);
  res.status(200).json({
    alerts,
    total: alerts.length,
    timestamp: new Date().toISOString()
  });
});

/**
 * Performance metrics endpoint
 * Returns performance-specific metrics
 */
router.get('/performance', authenticate, requireRole(ROLES.SYSTEM_ADMIN), (req, res) => {
  const metrics = monitoringService.getMetrics();
  const performanceMetrics = {
    timestamp: new Date().toISOString(),
    requests: {
      total: metrics.requests.total,
      successful: metrics.requests.successful,
      failed: metrics.requests.failed,
      errorRate: metrics.requests.total > 0 ? 
        ((metrics.requests.failed / metrics.requests.total) * 100).toFixed(2) + '%' : '0%',
      averageResponseTime: metrics.performance.averageResponseTime.toFixed(2) + 'ms'
    },
    votes: {
      total: metrics.votes.total,
      successful: metrics.votes.successful,
      failed: metrics.votes.failed,
      failureRate: metrics.votes.total > 0 ? 
        ((metrics.votes.failed / metrics.votes.total) * 100).toFixed(2) + '%' : '0%',
      averageProcessingTime: metrics.votes.averageProcessingTime.toFixed(2) + 'ms',
      duplicates: metrics.votes.duplicates,
      biometricFailures: metrics.votes.biometricFailures
    },
    database: {
      queries: metrics.database.queries,
      slowQueries: metrics.database.slowQueries,
      errors: metrics.database.errors,
      slowQueryRate: metrics.database.queries > 0 ? 
        ((metrics.database.slowQueries / metrics.database.queries) * 100).toFixed(2) + '%' : '0%'
    },
    cache: {
      hits: metrics.cache.hits,
      misses: metrics.cache.misses,
      errors: metrics.cache.errors,
      fallbackUsed: metrics.cache.fallbackUsed,
      hitRate: (metrics.cache.hits + metrics.cache.misses) > 0 ? 
        ((metrics.cache.hits / (metrics.cache.hits + metrics.cache.misses)) * 100).toFixed(2) + '%' : 'N/A'
    },
    memory: {
      ...metrics.memory,
      heapUsagePercent: ((metrics.memory.heapUsed / metrics.memory.heapTotal) * 100).toFixed(2) + '%'
    }
  };

  res.status(200).json(performanceMetrics);
});

/**
 * Deep health check - comprehensive system validation
 * Should only be used for debugging, not for regular health checks
 */
router.get('/deep', async (req, res) => {
  const deepCheck = {
    timestamp: new Date().toISOString(),
    service: 'biometric-voting-portal',
    comprehensive_checks: {}
  };

  let overallHealthy = true;

  try {
    // Test database operations
    const User = require('../models/User');
    const Vote = require('../models/Vote');
    const Award = require('../models/Award');

    const userCount = await User.countDocuments();
    const voteCount = await Vote.countDocuments();
    const awardCount = await Award.countDocuments();

    deepCheck.comprehensive_checks.database = {
      status: 'healthy',
      collections: {
        users: userCount,
        votes: voteCount,
        awards: awardCount
      }
    };
  } catch (error) {
    deepCheck.comprehensive_checks.database = {
      status: 'unhealthy',
      error: error.message
    };
    overallHealthy = false;
  }

  try {
    // Test Redis operations
    const testKey = `health_check_${Date.now()}`;
    await redisService.getClient().set(testKey, 'test', 'EX', 10);
    const testValue = await redisService.getClient().get(testKey);
    await redisService.getClient().del(testKey);

    deepCheck.comprehensive_checks.redis = {
      status: testValue === 'test' ? 'healthy' : 'unhealthy',
      test_result: testValue
    };
  } catch (error) {
    deepCheck.comprehensive_checks.redis = {
      status: 'unhealthy',
      error: error.message
    };
    // Redis failure doesn't fail the deep check due to fallbacks
  }

  try {
    // Test S3 operations
    const testKey = `health-check-${Date.now()}.txt`;
    await s3.putObject({
      Bucket: bucketName,
      Key: testKey,
      Body: 'health check test',
      ContentType: 'text/plain'
    }).promise();

    await s3.deleteObject({
      Bucket: bucketName,
      Key: testKey
    }).promise();

    deepCheck.comprehensive_checks.s3 = {
      status: 'healthy',
      bucket: bucketName
    };
  } catch (error) {
    deepCheck.comprehensive_checks.s3 = {
      status: 'unhealthy',
      error: error.message
    };
    // S3 failure doesn't fail the deep check due to circuit breakers
  }

  deepCheck.status = overallHealthy ? 'healthy' : 'unhealthy';
  const statusCode = overallHealthy ? 200 : 503;

  res.status(statusCode).json(deepCheck);
});

module.exports = router;