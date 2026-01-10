const request = require('supertest');
const express = require('express');
const errorHandler = require('../src/middleware/errorHandler');

// Create a test app with error handler
const createTestApp = () => {
  const app = express();
  app.use(express.json());

  // Test routes that throw different types of errors
  app.get('/test/validation-error', (req, res, next) => {
    const error = new Error('Validation failed');
    error.name = 'ValidationError';
    error.errors = {
      field1: { message: 'Field 1 is required' },
      field2: { message: 'Field 2 is invalid' }
    };
    next(error);
  });

  app.get('/test/duplicate-key-error', (req, res, next) => {
    const error = new Error('Duplicate key error');
    error.code = 11000;
    error.keyValue = { email: 'test@example.com' };
    next(error);
  });

  app.get('/test/jwt-error', (req, res, next) => {
    const error = new Error('Invalid token');
    error.name = 'JsonWebTokenError';
    next(error);
  });

  app.get('/test/token-expired-error', (req, res, next) => {
    const error = new Error('Token expired');
    error.name = 'TokenExpiredError';
    next(error);
  });

  app.get('/test/mongo-network-error', (req, res, next) => {
    const error = new Error('Connection failed');
    error.name = 'MongoNetworkError';
    next(error);
  });

  app.get('/test/redis-connection-error', (req, res, next) => {
    const error = new Error('Redis connection failed');
    error.code = 'ECONNREFUSED';
    error.message = 'connect ECONNREFUSED 127.0.0.1:6379 redis';
    next(error);
  });

  app.get('/test/rate-limit-error', (req, res, next) => {
    const error = new Error('Too many requests');
    error.statusCode = 429;
    error.retryAfter = 60;
    next(error);
  });

  app.get('/test/biometric-verification-failed', (req, res, next) => {
    const error = new Error('Biometric verification failed');
    error.code = 'BIOMETRIC_VERIFICATION_FAILED';
    error.details = { reason: 'Face not recognized' };
    next(error);
  });

  app.get('/test/biometric-verification-required', (req, res, next) => {
    const error = new Error('Biometric verification required');
    error.code = 'BIOMETRIC_VERIFICATION_REQUIRED';
    next(error);
  });

  app.get('/test/file-too-large', (req, res, next) => {
    const error = new Error('File too large');
    error.code = 'LIMIT_FILE_SIZE';
    error.limit = 5242880; // 5MB
    error.received = 10485760; // 10MB
    next(error);
  });

  app.get('/test/invalid-file-type', (req, res, next) => {
    const error = new Error('Invalid file type');
    error.code = 'LIMIT_UNEXPECTED_FILE';
    next(error);
  });

  app.get('/test/s3-error', (req, res, next) => {
    const error = new Error('Access denied');
    error.code = 'AccessDenied';
    next(error);
  });

  app.get('/test/circuit-breaker-open', (req, res, next) => {
    const error = new Error('Circuit breaker is open');
    error.code = 'CIRCUIT_BREAKER_OPEN';
    next(error);
  });

  app.get('/test/timeout-error', (req, res, next) => {
    const error = new Error('Request timeout');
    error.code = 'ETIMEDOUT';
    next(error);
  });

  app.get('/test/custom-application-error', (req, res, next) => {
    const error = new Error('Custom application error');
    error.statusCode = 422;
    error.code = 'CUSTOM_ERROR';
    error.details = { customField: 'customValue' };
    error.retryable = true;
    error.retryAfter = 30;
    next(error);
  });

  app.get('/test/generic-error', (req, res, next) => {
    const error = new Error('Something went wrong');
    next(error);
  });

  // Add error handler
  app.use(errorHandler);

  return app;
};

describe('Error Handler Middleware', () => {
  let app;

  beforeEach(() => {
    app = createTestApp();
  });

  describe('Validation Errors', () => {
    it('should handle Mongoose validation errors', async () => {
      const response = await request(app)
        .get('/test/validation-error')
        .expect(400);

      expect(response.body.error).toMatchObject({
        code: 'VALIDATION_ERROR',
        message: 'Validation failed',
        retryable: false,
        category: 'VALIDATION_ERROR',
        severity: 'LOW'
      });

      expect(response.body.error.details.fields).toEqual([
        'Field 1 is required',
        'Field 2 is invalid'
      ]);
      expect(response.body.error.details.invalidFields).toEqual(['field1', 'field2']);
      expect(response.body.error.errorId).toBeDefined();
      expect(response.body.error.timestamp).toBeDefined();
    });
  });

  describe('Database Errors', () => {
    it('should handle MongoDB duplicate key errors', async () => {
      const response = await request(app)
        .get('/test/duplicate-key-error')
        .expect(409);

      expect(response.body.error).toMatchObject({
        code: 'DUPLICATE_ENTRY',
        message: 'email already exists',
        retryable: false,
        category: 'CLIENT_ERROR',
        severity: 'LOW'
      });

      expect(response.body.error.details).toEqual({
        field: 'email',
        value: 'test@example.com'
      });
    });

    it('should handle MongoDB network errors', async () => {
      const response = await request(app)
        .get('/test/mongo-network-error')
        .expect(503);

      expect(response.body.error).toMatchObject({
        code: 'DATABASE_UNAVAILABLE',
        message: 'Database service temporarily unavailable',
        retryable: true,
        retryAfter: 30,
        category: 'EXTERNAL_SERVICE_ERROR',
        severity: 'CRITICAL'
      });

      expect(response.headers['retry-after']).toBe('30');
    });
  });

  describe('Authentication Errors', () => {
    it('should handle JWT validation errors', async () => {
      const response = await request(app)
        .get('/test/jwt-error')
        .expect(401);

      expect(response.body.error).toMatchObject({
        code: 'INVALID_TOKEN',
        message: 'Invalid authentication token',
        retryable: false,
        category: 'SECURITY_ERROR',
        severity: 'HIGH'
      });
    });

    it('should handle JWT expiration errors', async () => {
      const response = await request(app)
        .get('/test/token-expired-error')
        .expect(401);

      expect(response.body.error).toMatchObject({
        code: 'TOKEN_EXPIRED',
        message: 'Authentication token has expired',
        retryable: false,
        category: 'SECURITY_ERROR',
        severity: 'MEDIUM'
      });
    });
  });

  describe('External Service Errors', () => {
    it('should handle Redis connection errors', async () => {
      const response = await request(app)
        .get('/test/redis-connection-error')
        .expect(503);

      expect(response.body.error).toMatchObject({
        code: 'CACHE_UNAVAILABLE',
        message: 'Cache service temporarily unavailable',
        retryable: true,
        retryAfter: 15,
        category: 'EXTERNAL_SERVICE_ERROR',
        severity: 'HIGH'
      });

      expect(response.headers['retry-after']).toBe('15');
    });

    it('should handle S3 errors', async () => {
      const response = await request(app)
        .get('/test/s3-error')
        .expect(503);

      expect(response.body.error).toMatchObject({
        code: 'STORAGE_SERVICE_ERROR',
        message: 'Storage service temporarily unavailable',
        retryable: true,
        retryAfter: 30,
        category: 'EXTERNAL_SERVICE_ERROR',
        severity: 'HIGH'
      });
    });

    it('should handle circuit breaker errors', async () => {
      const response = await request(app)
        .get('/test/circuit-breaker-open')
        .expect(503);

      expect(response.body.error).toMatchObject({
        code: 'SERVICE_UNAVAILABLE',
        message: 'Service temporarily unavailable due to high error rate',
        retryable: true,
        retryAfter: 60,
        category: 'EXTERNAL_SERVICE_ERROR',
        severity: 'HIGH'
      });

      expect(response.headers['retry-after']).toBe('60');
    });

    it('should handle timeout errors', async () => {
      const response = await request(app)
        .get('/test/timeout-error')
        .expect(408);

      expect(response.body.error).toMatchObject({
        code: 'REQUEST_TIMEOUT',
        message: 'Request timed out, please try again',
        retryable: true,
        retryAfter: 10,
        category: 'EXTERNAL_SERVICE_ERROR',
        severity: 'MEDIUM'
      });
    });
  });

  describe('Rate Limiting Errors', () => {
    it('should handle rate limit errors', async () => {
      const response = await request(app)
        .get('/test/rate-limit-error')
        .expect(429);

      expect(response.body.error).toMatchObject({
        code: 'RATE_LIMIT_EXCEEDED',
        message: 'Too many requests, please try again later',
        retryable: true,
        category: 'CLIENT_ERROR',
        severity: 'MEDIUM'
      });

      expect(response.headers['retry-after']).toBe('60');
    });
  });

  describe('Biometric Verification Errors', () => {
    it('should handle biometric verification failures', async () => {
      const response = await request(app)
        .get('/test/biometric-verification-failed')
        .expect(403);

      expect(response.body.error).toMatchObject({
        code: 'BIOMETRIC_VERIFICATION_FAILED',
        message: 'Biometric verification failed',
        retryable: true,
        category: 'CLIENT_ERROR',
        severity: 'MEDIUM'
      });

      expect(response.body.error.details).toEqual({ reason: 'Face not recognized' });
    });

    it('should handle biometric verification required', async () => {
      const response = await request(app)
        .get('/test/biometric-verification-required')
        .expect(428);

      expect(response.body.error).toMatchObject({
        code: 'BIOMETRIC_VERIFICATION_REQUIRED',
        message: 'Biometric verification required for this action',
        retryable: true,
        category: 'CLIENT_ERROR',
        severity: 'LOW'
      });

      expect(response.body.error.details.supportedMethods).toEqual([
        'Face ID', 'Touch ID', 'Windows Hello'
      ]);
    });
  });

  describe('File Upload Errors', () => {
    it('should handle file size limit errors', async () => {
      const response = await request(app)
        .get('/test/file-too-large')
        .expect(413);

      expect(response.body.error).toMatchObject({
        code: 'FILE_TOO_LARGE',
        message: 'File size exceeds maximum allowed limit',
        retryable: false,
        category: 'CLIENT_ERROR',
        severity: 'LOW'
      });

      expect(response.body.error.details).toEqual({
        maxSize: 5242880,
        receivedSize: 10485760,
        maxSizeFormatted: '5MB'
      });
    });

    it('should handle invalid file type errors', async () => {
      const response = await request(app)
        .get('/test/invalid-file-type')
        .expect(400);

      expect(response.body.error).toMatchObject({
        code: 'INVALID_FILE_TYPE',
        message: 'Invalid file type uploaded',
        retryable: false,
        category: 'CLIENT_ERROR',
        severity: 'LOW'
      });

      expect(response.body.error.details.allowedTypes).toEqual([
        'image/jpeg', 'image/png', 'image/webp'
      ]);
    });
  });

  describe('Custom Application Errors', () => {
    it('should handle custom application errors', async () => {
      const response = await request(app)
        .get('/test/custom-application-error')
        .expect(422);

      expect(response.body.error).toMatchObject({
        code: 'CUSTOM_ERROR',
        message: 'Custom application error',
        retryable: true,
        category: 'SERVER_ERROR',
        severity: 'MEDIUM'
      });

      expect(response.body.error.details).toEqual({ customField: 'customValue' });
      expect(response.headers['retry-after']).toBe('30');
    });
  });

  describe('Generic Errors', () => {
    it('should handle generic errors', async () => {
      const response = await request(app)
        .get('/test/generic-error')
        .expect(500);

      expect(response.body.error).toMatchObject({
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Something went wrong!',
        retryable: true,
        category: 'SERVER_ERROR',
        severity: 'HIGH'
      });

      expect(response.body.error.errorId).toBeDefined();
      expect(response.body.error.timestamp).toBeDefined();
      expect(response.body.error.supportInfo).toBeDefined();
    });
  });

  describe('Error Response Structure', () => {
    it('should include all required error fields', async () => {
      const response = await request(app)
        .get('/test/validation-error')
        .expect(400);

      const error = response.body.error;

      // Required fields
      expect(error.code).toBeDefined();
      expect(error.message).toBeDefined();
      expect(error.retryable).toBeDefined();
      expect(error.timestamp).toBeDefined();
      expect(error.errorId).toBeDefined();
      expect(error.category).toBeDefined();
      expect(error.severity).toBeDefined();

      // Error ID format
      expect(error.errorId).toMatch(/^err_\d+_[a-z0-9]+$/);

      // Timestamp format (ISO string)
      expect(new Date(error.timestamp).toISOString()).toBe(error.timestamp);
    });

    it('should include user action guidance when available', async () => {
      const response = await request(app)
        .get('/test/validation-error')
        .expect(400);

      expect(response.body.error.userAction).toBe('Please check your input and try again');
    });

    it('should include fallback information when available', async () => {
      const response = await request(app)
        .get('/test/mongo-network-error')
        .expect(503);

      expect(response.body.error.fallbackInfo).toBe('Some features may be limited while database is recovering');
    });
  });
});