const jwtService = require('../services/jwtService');
const User = require('../models/User');
const securityLogger = require('../utils/securityLogger');

/**
 * Authentication middleware to verify JWT tokens
 * Extracts token from Authorization header or cookies
 */
const authenticate = async (req, res, next) => {
  try {
    let token = null;
    
    // Try to get token from Authorization header first
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      token = authHeader.substring(7);
    }
    
    // Fallback to cookie if no header token
    if (!token && req.cookies && req.cookies.accessToken) {
      token = req.cookies.accessToken;
    }
    
    if (!token) {
      return res.status(401).json({
        error: {
          code: 'NO_TOKEN',
          message: 'Access token is required',
          retryable: false
        }
      });
    }
    
    // Verify the token
    const decoded = jwtService.verifyAccessToken(token);
    
    // Check if token is blacklisted
    const isBlacklisted = await jwtService.isTokenBlacklisted(decoded.tokenId);
    if (isBlacklisted) {
      return res.status(401).json({
        error: {
          code: 'TOKEN_REVOKED',
          message: 'Token has been revoked',
          retryable: false
        }
      });
    }
    
    // Get user from database to ensure they still exist and get latest role
    const user = await User.findById(decoded.userId).select('-__v');
    if (!user) {
      return res.status(401).json({
        error: {
          code: 'USER_NOT_FOUND',
          message: 'User associated with token not found',
          retryable: false
        }
      });
    }
    
    // Check if user's role has changed since token was issued
    if (user.role !== decoded.role) {
      // Log the role change but allow the request to proceed with updated role
      console.log(`User ${user.email} role changed from ${decoded.role} to ${user.role} - updating token context`);
      
      // Update the decoded role to match current user role
      const oldRole = decoded.role;
      decoded.role = user.role;
      
      // Log this for security monitoring but don't block the request
      try {
        securityLogger.logSuspiciousActivity({
          activity: 'ROLE_CHANGE_DETECTED',
          userId: user._id.toString(),
          description: `User role changed from ${oldRole} to ${user.role} during active session`,
          metadata: {
            oldRole: oldRole,
            newRole: user.role,
            tokenId: decoded.tokenId
          },
          ipAddress: req.ip,
          userAgent: req.get('User-Agent')
        });
      } catch (logError) {
        console.error('Failed to log role change:', logError);
        // Don't fail the request if logging fails
      }
    }
    
    // Attach user and token info to request
    req.user = user;
    req.tokenPayload = decoded;
    
    next();
  } catch (error) {
    console.error('Authentication error:', error);
    
    // Handle specific JWT errors
    if (error.message.includes('expired')) {
      return res.status(401).json({
        error: {
          code: 'TOKEN_EXPIRED',
          message: 'Access token has expired',
          retryable: true
        }
      });
    }
    
    if (error.message.includes('Invalid')) {
      return res.status(401).json({
        error: {
          code: 'INVALID_TOKEN',
          message: 'Invalid access token',
          retryable: false
        }
      });
    }
    
    return res.status(500).json({
      error: {
        code: 'AUTH_ERROR',
        message: 'Authentication failed',
        retryable: true
      }
    });
  }
};

/**
 * Optional authentication middleware
 * Sets req.user if valid token is provided, but doesn't fail if no token
 */
const optionalAuth = async (req, res, next) => {
  try {
    let token = null;
    
    // Try to get token from Authorization header first
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      token = authHeader.substring(7);
    }
    
    // Fallback to cookie if no header token
    if (!token && req.cookies && req.cookies.accessToken) {
      token = req.cookies.accessToken;
    }
    
    // If no token, continue without authentication
    if (!token) {
      return next();
    }
    
    try {
      // Verify the token
      const decoded = jwtService.verifyAccessToken(token);
      
      // Check if token is blacklisted
      const isBlacklisted = await jwtService.isTokenBlacklisted(decoded.tokenId);
      if (isBlacklisted) {
        return next(); // Continue without auth if token is revoked
      }
      
      // Get user from database
      const user = await User.findById(decoded.userId).select('-__v');
      if (user && user.role === decoded.role) {
        req.user = user;
        req.tokenPayload = decoded;
      }
    } catch (tokenError) {
      // Ignore token errors in optional auth
      console.log('Optional auth token error (ignored):', tokenError.message);
    }
    
    next();
  } catch (error) {
    console.error('Optional authentication error:', error);
    // Continue without authentication on any error
    next();
  }
};

/**
 * Refresh token authentication middleware
 * Specifically for refresh token endpoints
 */
const authenticateRefreshToken = async (req, res, next) => {
  try {
    let refreshToken = null;
    
    // Get refresh token from cookie
    if (req.cookies && req.cookies.refreshToken) {
      refreshToken = req.cookies.refreshToken;
    }
    
    // Fallback to request body
    if (!refreshToken && req.body && req.body.refreshToken) {
      refreshToken = req.body.refreshToken;
    }
    
    if (!refreshToken) {
      return res.status(401).json({
        error: {
          code: 'NO_REFRESH_TOKEN',
          message: 'Refresh token is required',
          retryable: false
        }
      });
    }
    
    // Verify the refresh token
    const decoded = jwtService.verifyRefreshToken(refreshToken);
    
    // Check if token family is revoked
    const isFamilyRevoked = await jwtService.isTokenFamilyRevoked(decoded.family);
    if (isFamilyRevoked) {
      return res.status(401).json({
        error: {
          code: 'TOKEN_FAMILY_REVOKED',
          message: 'Token family has been revoked due to security concerns',
          retryable: false
        }
      });
    }
    
    // Check for token reuse
    const securityContext = securityLogger.createSecurityContext(req);
    const isReused = await jwtService.trackTokenUsage(decoded.tokenId, decoded.family, {
      userId: decoded.userId,
      ...securityContext
    });
    
    if (isReused) {
      // Token reuse detected - revoke entire family
      await jwtService.revokeTokenFamily(decoded.family, {
        userId: decoded.userId,
        ...securityContext
      });
      
      return res.status(401).json({
        error: {
          code: 'TOKEN_REUSE_DETECTED',
          message: 'Token reuse detected. All tokens in family have been revoked.',
          retryable: false
        }
      });
    }
    
    // Get user from database
    const user = await User.findById(decoded.userId).select('-__v');
    if (!user) {
      return res.status(401).json({
        error: {
          code: 'USER_NOT_FOUND',
          message: 'User associated with refresh token not found',
          retryable: false
        }
      });
    }
    
    // Attach user and token info to request
    req.user = user;
    req.refreshTokenPayload = decoded;
    
    next();
  } catch (error) {
    console.error('Refresh token authentication error:', error);
    
    if (error.message.includes('expired')) {
      return res.status(401).json({
        error: {
          code: 'REFRESH_TOKEN_EXPIRED',
          message: 'Refresh token has expired',
          retryable: false
        }
      });
    }
    
    if (error.message.includes('Invalid')) {
      return res.status(401).json({
        error: {
          code: 'INVALID_REFRESH_TOKEN',
          message: 'Invalid refresh token',
          retryable: false
        }
      });
    }
    
    return res.status(500).json({
      error: {
        code: 'REFRESH_AUTH_ERROR',
        message: 'Refresh token authentication failed',
        retryable: true
      }
    });
  }
};

module.exports = {
  authenticate,
  optionalAuth,
  authenticateRefreshToken
};