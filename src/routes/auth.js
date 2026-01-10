const express = require('express');
const passport = require('../config/passport');
const jwtService = require('../services/jwtService');
const { authenticateRefreshToken } = require('../middleware/auth');
const { authRateLimit } = require('../middleware/rateLimit');
const User = require('../models/User');
const securityLogger = require('../utils/securityLogger');
const router = express.Router();

// Google OAuth login route
router.get('/google', 
  authRateLimit,
  passport.authenticate('google', { 
    scope: ['profile', 'email'] 
  })
);

// Google OAuth callback route
router.get('/google/callback',
  authRateLimit,
  passport.authenticate('google', { 
    failureRedirect: `${process.env.FRONTEND_URL}/login?error=oauth_failed`,
    session: false // We'll use JWT instead of sessions
  }),
  async (req, res) => {
    try {
      const user = req.user;
      
      if (!user) {
        return res.redirect(`${process.env.FRONTEND_URL}/login?error=user_not_found`);
      }
      
      // Generate JWT tokens
      const { accessToken, refreshToken } = jwtService.generateTokenPair(user);
      
      // Set secure httpOnly cookies
      jwtService.setTokenCookies(res, accessToken, refreshToken);
      
      // Redirect to frontend with success
      res.redirect(`${process.env.FRONTEND_URL}/?login=success`);
      
    } catch (error) {
      console.error('OAuth callback error:', error);
      res.redirect(`${process.env.FRONTEND_URL}/login?error=server_error`);
    }
  }
);

// Token refresh route
router.post('/refresh', authRateLimit, authenticateRefreshToken, async (req, res) => {
  try {
    const user = req.user;
    const oldRefreshToken = req.cookies.refreshToken || req.body.refreshToken;
    
    if (!oldRefreshToken) {
      return res.status(401).json({
        error: {
          code: 'NO_REFRESH_TOKEN',
          message: 'Refresh token is required',
          retryable: false
        }
      });
    }
    
    // Create security context for logging
    const securityContext = securityLogger.createSecurityContext(req);
    
    // Rotate tokens with security context
    const { accessToken, refreshToken } = await jwtService.rotateTokens(
      oldRefreshToken, 
      user, 
      securityContext
    );
    
    // Set new secure cookies
    jwtService.setTokenCookies(res, accessToken, refreshToken);
    
    res.json({
      message: 'Tokens refreshed successfully',
      user: {
        id: user._id,
        email: user.email,
        name: user.name,
        role: user.role
      }
    });
    
  } catch (error) {
    console.error('Token refresh error:', error);
    
    // Clear cookies on any refresh error
    jwtService.clearTokenCookies(res);
    
    // Create security context for error logging
    const securityContext = securityLogger.createSecurityContext(req);
    
    if (error.message.includes('Token reuse detected')) {
      securityLogger.logAuthFailure({
        reason: 'TOKEN_REUSE_DETECTED',
        userId: req.user?._id,
        description: 'Token reuse detected during refresh',
        ...securityContext
      });
      
      return res.status(401).json({
        error: {
          code: 'TOKEN_REUSE_DETECTED',
          message: 'Token reuse detected. Please re-authenticate.',
          retryable: false
        }
      });
    }
    
    if (error.message.includes('Token family has been revoked')) {
      securityLogger.logAuthFailure({
        reason: 'TOKEN_FAMILY_REVOKED',
        userId: req.user?._id,
        description: 'Attempted to use token from revoked family',
        ...securityContext
      });
      
      return res.status(401).json({
        error: {
          code: 'TOKEN_FAMILY_REVOKED',
          message: 'Token family revoked. Please re-authenticate.',
          retryable: false
        }
      });
    }
    
    if (error.message.includes('expired')) {
      securityLogger.logAuthFailure({
        reason: 'REFRESH_TOKEN_EXPIRED',
        userId: req.user?._id,
        description: 'Refresh token expired',
        ...securityContext
      });
      
      return res.status(401).json({
        error: {
          code: 'REFRESH_TOKEN_EXPIRED',
          message: 'Refresh token has expired. Please re-authenticate.',
          retryable: false
        }
      });
    }
    
    securityLogger.logAuthFailure({
      reason: 'TOKEN_REFRESH_FAILED',
      userId: req.user?._id,
      description: 'Token refresh failed',
      ...securityContext
    });
    
    return res.status(401).json({
      error: {
        code: 'TOKEN_REFRESH_FAILED',
        message: 'Failed to refresh tokens. Please re-authenticate.',
        retryable: false
      }
    });
  }
});

// Logout route
router.post('/logout', async (req, res) => {
  try {
    // Get tokens from cookies to blacklist them
    const accessToken = req.cookies.accessToken;
    const refreshToken = req.cookies.refreshToken;
    
    // Create security context for logging
    const securityContext = securityLogger.createSecurityContext(req);
    
    // Blacklist tokens if they exist
    if (accessToken) {
      try {
        const decoded = jwtService.verifyAccessToken(accessToken);
        const ttl = jwtService.calculateTokenTTL(accessToken);
        await jwtService.blacklistToken(decoded.tokenId, ttl, {
          reason: 'LOGOUT',
          userId: decoded.userId,
          ...securityContext
        });
      } catch (error) {
        // Token might be invalid/expired, continue with logout
        console.log('Could not blacklist access token during logout:', error.message);
      }
    }
    
    if (refreshToken) {
      try {
        const decoded = jwtService.verifyRefreshToken(refreshToken);
        const ttl = jwtService.calculateTokenTTL(refreshToken);
        await jwtService.blacklistToken(decoded.tokenId, ttl, {
          reason: 'LOGOUT',
          userId: decoded.userId,
          ...securityContext
        });
      } catch (error) {
        // Token might be invalid/expired, continue with logout
        console.log('Could not blacklist refresh token during logout:', error.message);
      }
    }
    
    // Clear cookies
    jwtService.clearTokenCookies(res);
    
    res.json({
      message: 'Logged out successfully'
    });
  } catch (error) {
    console.error('Logout error:', error);
    
    // Still clear cookies even if blacklisting failed
    jwtService.clearTokenCookies(res);
    
    res.status(500).json({
      error: {
        code: 'LOGOUT_ERROR',
        message: 'Failed to logout completely, but cookies cleared',
        retryable: true
      }
    });
  }
});

// Get current user profile
router.get('/me', async (req, res) => {
  try {
    // Extract token from cookies
    const accessToken = req.cookies.accessToken;
    
    if (!accessToken) {
      return res.status(401).json({
        error: {
          code: 'NO_ACCESS_TOKEN',
          message: 'Access token required',
          retryable: false
        }
      });
    }
    
    // Verify and decode token
    const decoded = jwtService.verifyAccessToken(accessToken);
    
    // Get user from database
    const user = await User.findById(decoded.userId).select('-webAuthnCredentials -currentChallenge');
    
    if (!user) {
      return res.status(404).json({
        error: {
          code: 'USER_NOT_FOUND',
          message: 'User not found',
          retryable: false
        }
      });
    }
    
    res.json({
      user: {
        id: user._id,
        email: user.email,
        name: user.name,
        role: user.role,
        createdAt: user.createdAt,
        lastLogin: user.lastLogin
      }
    });
  } catch (error) {
    console.error('Get current user error:', error);
    
    if (error.name === 'JsonWebTokenError' || error.name === 'TokenExpiredError') {
      return res.status(401).json({
        error: {
          code: 'INVALID_TOKEN',
          message: 'Invalid or expired token',
          retryable: false
        }
      });
    }
    
    res.status(500).json({
      error: {
        code: 'GET_USER_ERROR',
        message: 'Failed to get user information',
        retryable: true
      }
    });
  }
});

// Get current user profile (legacy endpoint)
router.get('/profile', async (req, res) => {
  try {
    // This route will be protected by auth middleware in the future
    // For now, just return a placeholder response
    res.json({
      message: 'Profile endpoint - will be protected by auth middleware'
    });
  } catch (error) {
    console.error('Profile error:', error);
    res.status(500).json({
      error: {
        code: 'PROFILE_ERROR',
        message: 'Failed to get profile',
        retryable: true
      }
    });
  }
});

module.exports = router;