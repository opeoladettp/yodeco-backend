// Load environment variables first, before any other imports
require('dotenv').config();

const express = require('express');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const rateLimit = require('express-rate-limit');
const passport = require('./config/passport');

const connectDB = require('./config/database');
const { connectRedis } = require('./config/redis');
const apiRoutes = require('./routes');
const { errorHandler, requestMonitoring, errorMonitoring } = require('./middleware');
const backgroundJobs = require('./services/backgroundJobs');

const app = express();

// Trust proxy for Railway deployment
if (process.env.NODE_ENV === 'production' && process.env.RAILWAY_ENVIRONMENT) {
  app.set('trust proxy', true);
}

// Global CORS middleware - add headers to ALL responses
app.use((req, res, next) => {
  if (process.env.NODE_ENV === 'production' && process.env.RAILWAY_ENVIRONMENT) {
    // Set CORS headers for all requests
    res.header('Access-Control-Allow-Origin', req.headers.origin || 'https://portal.yodeco.ng');
    res.header('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS,PATCH');
    res.header('Access-Control-Allow-Headers', '*');
    res.header('Access-Control-Allow-Credentials', 'true');
    res.header('Access-Control-Expose-Headers', 'set-cookie');
    
    // Handle preflight requests immediately
    if (req.method === 'OPTIONS') {
      console.log('🔍 Global OPTIONS handler:', {
        origin: req.headers.origin,
        method: req.headers['access-control-request-method'],
        headers: req.headers['access-control-request-headers']
      });
      return res.sendStatus(200);
    }
  }
  next();
});

// Security middleware
app.use(helmet());

// Additional CORS configuration for Railway deployment (backup)
if (process.env.NODE_ENV === 'production' && process.env.RAILWAY_ENVIRONMENT) {
  console.log('CORS configured for Railway deployment with global headers');
} else {
  // EC2 deployment - CORS handled by nginx
  console.log('CORS handling delegated to nginx proxy');
}

// Rate limiting with admin IP bypass
if (process.env.NODE_ENV === 'production') {
  // Get admin whitelist IPs from environment
  const adminIPs = process.env.ADMIN_WHITELIST_IPS ? 
    process.env.ADMIN_WHITELIST_IPS.split(',').map(ip => ip.trim()) : [];
  
  const limiter = rateLimit({
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000, // 15 minutes
    max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 500, // limit each IP to 500 requests per windowMs (increased for testing)
    message: 'Too many requests from this IP, please try again later.',
    skip: (req) => {
      // Skip rate limiting for admin IPs
      const clientIP = req.ip || req.connection.remoteAddress || req.socket.remoteAddress || 
                      req.headers['x-forwarded-for']?.split(',')[0]?.trim() || 
                      req.headers['x-real-ip'];
      
      const isAdmin = adminIPs.includes(clientIP) || req.headers['x-admin-ip'] === '1';
      
      if (isAdmin) {
        console.log(`🔓 Admin IP bypass: ${clientIP}`);
        return true;
      }
      return false;
    }
  });
  app.use('/api/', limiter);
  console.log(`Rate limiting enabled for production (admin IPs whitelisted: ${adminIPs.join(', ') || 'none'})`);
} else {
  console.log('Rate limiting disabled for development');
}

// Body parsing middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// Initialize Passport
app.use(passport.initialize());

// Request monitoring middleware
app.use(requestMonitoring);

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'OK',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    environment: process.env.NODE_ENV || 'development'
  });
});

// API routes
app.use('/api', apiRoutes);

// Error monitoring middleware (before error handler)
app.use(errorMonitoring);

// Error handling middleware
app.use(errorHandler);

// Temporary IP detection endpoint for Railway
app.get('/api/my-ip', (req, res) => {
  const clientIP = req.headers['x-forwarded-for'] || 
                   req.headers['x-real-ip'] || 
                   req.connection.remoteAddress || 
                   req.socket.remoteAddress ||
                   (req.connection.socket ? req.connection.socket.remoteAddress : null);
  
  res.json({
    success: true,
    data: {
      clientIP: clientIP,
      headers: {
        'x-forwarded-for': req.headers['x-forwarded-for'],
        'x-real-ip': req.headers['x-real-ip'],
        'cf-connecting-ip': req.headers['cf-connecting-ip'],
        'x-forwarded-proto': req.headers['x-forwarded-proto']
      },
      timestamp: new Date().toISOString()
    }
  });
});

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({
    error: {
      code: 'NOT_FOUND',
      message: 'Route not found',
      retryable: false
    }
  });
});

const PORT = process.env.PORT || 5000;

async function startServer() {
  try {
    // Connect to databases
    await connectDB();
    await connectRedis();
    
    // Start background jobs
    backgroundJobs.start();
    
    app.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
      console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
      console.log(`Frontend URL: ${process.env.FRONTEND_URL || 'http://localhost:3000'}`);
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully...');
  backgroundJobs.stop();
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('SIGINT received, shutting down gracefully...');
  backgroundJobs.stop();
  process.exit(0);
});

startServer();

module.exports = app;