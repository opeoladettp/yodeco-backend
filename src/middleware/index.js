// Middleware exports will be added as middleware is created
// This file serves as a central export point for all middleware

const errorHandler = require('./errorHandler');
const { validate, schemas } = require('./validation');
const { authenticate, optionalAuth, authenticateRefreshToken } = require('./auth');
const { 
  ROLES, 
  requirePermission, 
  requireRole, 
  requireAllPermissions, 
  requireAnyPermission, 
  requireOwnershipOrAdmin,
  hasPermission,
  hasMinimumRole,
  getRolePermissions
} = require('./rbac');
const { requireBiometricVerification } = require('./biometricAuth');
const {
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
} = require('./rateLimit');
const {
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
  generateHashKey
} = require('./idempotency');
const {
  requestMonitoring,
  errorMonitoring,
  voteMonitoring,
  authMonitoring,
  databaseMonitoring,
  cacheMonitoring
} = require('./monitoring');

module.exports = {
  errorHandler,
  validate,
  schemas,
  authenticate,
  optionalAuth,
  authenticateRefreshToken,
  ROLES,
  requirePermission,
  requireRole,
  requireAllPermissions,
  requireAnyPermission,
  requireOwnershipOrAdmin,
  hasPermission,
  hasMinimumRole,
  getRolePermissions,
  requireBiometricVerification,
  createRateLimit,
  authRateLimit,
  voteRateLimit,
  webauthnRateLimit,
  generalRateLimit,
  customRateLimit,
  rateLimitCleanup,
  getRateLimitStatus,
  clearRateLimit,
  DEFAULT_LIMITS,
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
  requestMonitoring,
  errorMonitoring,
  voteMonitoring,
  authMonitoring,
  databaseMonitoring,
  cacheMonitoring
};