const express = require('express');
const mongoose = require('mongoose');
const { getRedisClient } = require('../config/redis');

const router = express.Router();

/**
 * Health check endpoint
 * GET /api/health
 */
router.get('/', async (req, res) => {
  const health = {
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    environment: process.env.NODE_ENV,
    version: process.env.npm_package_version || '1.0.0',
    services: {}
  };

  try {
    // Check MongoDB connection
    if (mongoose.connection.readyState === 1) {
      health.services.mongodb = { status: 'connected' };
    } else {
      health.services.mongodb = { status: 'disconnected' };
      health.status = 'degraded';
    }

    // Check Redis connection
    try {
      const redisClient = getRedisClient();
      if (redisClient && redisClient.isOpen) {
        await redisClient.ping();
        health.services.redis = { status: 'connected' };
      } else {
        health.services.redis = { status: 'disconnected' };
        health.status = 'degraded';
      }
    } catch (redisError) {
      health.services.redis = { 
        status: 'error', 
        error: redisError.message 
      };
      health.status = 'degraded';
    }

    // Check memory usage
    const memUsage = process.memoryUsage();
    health.memory = {
      rss: `${Math.round(memUsage.rss / 1024 / 1024)}MB`,
      heapTotal: `${Math.round(memUsage.heapTotal / 1024 / 1024)}MB`,
      heapUsed: `${Math.round(memUsage.heapUsed / 1024 / 1024)}MB`,
      external: `${Math.round(memUsage.external / 1024 / 1024)}MB`
    };

    // Set appropriate status code
    const statusCode = health.status === 'ok' ? 200 : 503;
    res.status(statusCode).json(health);

  } catch (error) {
    console.error('Health check error:', error);
    res.status(503).json({
      status: 'error',
      timestamp: new Date().toISOString(),
      error: error.message
    });
  }
});

/**
 * Readiness check endpoint
 * GET /api/health/ready
 */
router.get('/ready', async (req, res) => {
  try {
    // Check if all critical services are ready
    const isMongoReady = mongoose.connection.readyState === 1;
    
    let isRedisReady = false;
    try {
      const redisClient = getRedisClient();
      if (redisClient && redisClient.isOpen) {
        await redisClient.ping();
        isRedisReady = true;
      }
    } catch (redisError) {
      console.warn('Redis not ready:', redisError.message);
    }

    if (isMongoReady && isRedisReady) {
      res.status(200).json({
        status: 'ready',
        timestamp: new Date().toISOString(),
        services: {
          mongodb: 'ready',
          redis: 'ready'
        }
      });
    } else {
      res.status(503).json({
        status: 'not ready',
        timestamp: new Date().toISOString(),
        services: {
          mongodb: isMongoReady ? 'ready' : 'not ready',
          redis: isRedisReady ? 'ready' : 'not ready'
        }
      });
    }
  } catch (error) {
    console.error('Readiness check error:', error);
    res.status(503).json({
      status: 'error',
      timestamp: new Date().toISOString(),
      error: error.message
    });
  }
});

/**
 * Liveness check endpoint
 * GET /api/health/live
 */
router.get('/live', (req, res) => {
  res.status(200).json({
    status: 'alive',
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

/**
 * Health summary endpoint
 * GET /api/health/summary
 */
router.get('/summary', async (req, res) => {
  try {
    const summary = {
      status: 'ok',
      timestamp: new Date().toISOString(),
      services: {
        api: 'operational',
        database: mongoose.connection.readyState === 1 ? 'operational' : 'degraded',
        cache: 'checking...'
      },
      metrics: {
        uptime: Math.floor(process.uptime()),
        memory: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
        cpu: 'N/A'
      }
    };

    // Check Redis
    try {
      const redisClient = getRedisClient();
      if (redisClient && redisClient.isOpen) {
        await redisClient.ping();
        summary.services.cache = 'operational';
      } else {
        summary.services.cache = 'degraded';
        summary.status = 'degraded';
      }
    } catch (error) {
      summary.services.cache = 'error';
      summary.status = 'degraded';
    }

    res.json(summary);
  } catch (error) {
    res.status(503).json({
      status: 'error',
      timestamp: new Date().toISOString(),
      error: error.message
    });
  }
});

/**
 * Performance metrics endpoint
 * GET /api/health/performance
 */
router.get('/performance', (req, res) => {
  const memUsage = process.memoryUsage();
  const performance = {
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    memory: {
      rss: memUsage.rss,
      heapTotal: memUsage.heapTotal,
      heapUsed: memUsage.heapUsed,
      external: memUsage.external
    },
    cpu: process.cpuUsage(),
    platform: process.platform,
    nodeVersion: process.version
  };

  res.json(performance);
});

/**
 * System alerts endpoint
 * GET /api/health/alerts
 */
router.get('/alerts', (req, res) => {
  const alerts = [];
  const limit = parseInt(req.query.limit) || 20;

  // Check for potential issues
  const memUsage = process.memoryUsage();
  const heapUsedMB = memUsage.heapUsed / 1024 / 1024;

  if (heapUsedMB > 500) {
    alerts.push({
      id: 'high-memory',
      level: 'warning',
      message: `High memory usage: ${Math.round(heapUsedMB)}MB`,
      timestamp: new Date().toISOString()
    });
  }

  if (mongoose.connection.readyState !== 1) {
    alerts.push({
      id: 'db-connection',
      level: 'error',
      message: 'Database connection issue',
      timestamp: new Date().toISOString()
    });
  }

  // Limit results
  const limitedAlerts = alerts.slice(0, limit);

  res.json({
    alerts: limitedAlerts,
    total: alerts.length,
    limit: limit
  });
});

module.exports = router;