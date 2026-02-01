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

// Test endpoint to debug OAuth callback
router.get('/test-callback', async (req, res) => {
  try {
    console.log('🧪 Test callback endpoint hit');
    console.log('  Query parameters:', req.query);
    console.log('  Headers:', req.headers);
    
    res.json({
      message: 'Test callback endpoint working',
      query: req.query,
      headers: req.headers
    });
  } catch (error) {
    console.error('Test callback error:', error);
    res.status(500).json({ error: error.message });
  }
});

// Google OAuth callback route
router.get('/google/callback',
  (req, res, next) => {
    console.log('🔍 OAuth callback hit - before passport middleware');
    console.log('  Query params:', req.query);
    console.log('  Headers:', {
      'user-agent': req.get('User-Agent'),
      'referer': req.get('Referer'),
      'origin': req.get('Origin')
    });
    next();
  },
  authRateLimit,
  (req, res, next) => {
    passport.authenticate('google', { 
      failureRedirect: `${process.env.FRONTEND_URL}/login?error=oauth_failed`,
      session: false // We'll use JWT instead of sessions
    })(req, res, (err) => {
      if (err) {
        console.error('❌ Passport authentication error:', err);
        console.error('Error details:', {
          message: err.message,
          stack: err.stack,
          name: err.name
        });
        
        // Determine redirect URL for error
        let redirectUrl = process.env.FRONTEND_URL || 'https://portal.yodeco.ng';
        if (process.env.NODE_ENV === 'development') {
          redirectUrl = 'http://localhost:3000';
        }
        
        return res.redirect(`${redirectUrl}/login?error=passport_error&details=${encodeURIComponent(err.message)}`);
      }
      next();
    });
  },
  async (req, res) => {
    try {
      console.log('🔍 OAuth Callback Success Handler Started');
      console.log('  req.user exists:', !!req.user);
      console.log('  req.user type:', typeof req.user);
      
      const user = req.user;
      
      if (!user) {
        console.log('❌ No user found in req.user, redirecting to user_not_found');
        return res.redirect(`${process.env.FRONTEND_URL}/login?error=user_not_found`);
      }
      
      console.log('✅ User found:', { id: user._id, email: user.email, name: user.name });
      
      // Generate JWT tokens
      console.log('🔑 Generating JWT tokens...');
      const { accessToken, refreshToken } = jwtService.generateTokenPair(user);
      console.log('✅ JWT tokens generated successfully');
      console.log('  Access token length:', accessToken.length);
      console.log('  Refresh token length:', refreshToken.length);
      
      // Set secure httpOnly cookies (for browsers that support cross-subdomain)
      jwtService.setTokenCookies(res, accessToken, refreshToken);
      
      // QUICK FIX: Also pass token in URL for cross-subdomain compatibility
      const tokenParam = encodeURIComponent(accessToken);
      
      console.log('🔍 OAuth Callback Debug:');
      console.log('  Origin header:', req.get('Origin'));
      console.log('  Referer header:', req.get('Referer'));
      console.log('  Default FRONTEND_URL:', process.env.FRONTEND_URL);
      console.log('  Generated access token length:', accessToken.length);
      
      // Determine redirect URL based on environment and request context
      let redirectUrl = process.env.FRONTEND_URL || 'https://portal.yodeco.ng';
      
      // In development mode, always redirect to localhost
      if (process.env.NODE_ENV === 'development') {
        redirectUrl = 'http://localhost:3000';
        console.log('🔧 Development mode: Redirecting to localhost:3000');
      } else {
        // In production, use the configured FRONTEND_URL (should be portal.yodeco.ng)
        redirectUrl = process.env.FRONTEND_URL || 'https://portal.yodeco.ng';
        console.log('🌐 Production mode: Redirecting to configured frontend:', redirectUrl);
      }
      
      const finalRedirectUrl = `${redirectUrl}/?login=success&token=${tokenParam}`;
      console.log('🚀 Final OAuth redirect URL:', finalRedirectUrl);
      
      // Redirect to frontend with success and token
      res.redirect(finalRedirectUrl);
      
    } catch (error) {
      console.error('❌ OAuth callback error:', error);
      console.error('Error stack:', error.stack);
      
      // Use same logic for error redirects
      let redirectUrl = process.env.FRONTEND_URL || 'https://portal.yodeco.ng';
      
      // In development mode, always redirect to localhost
      if (process.env.NODE_ENV === 'development') {
        redirectUrl = 'http://localhost:3000';
      } else {
        // In production, use the configured FRONTEND_URL (should be portal.yodeco.ng)
        redirectUrl = process.env.FRONTEND_URL || 'https://portal.yodeco.ng';
        console.log('🌐 Production error redirect to:', redirectUrl);
      }
      
      console.log('OAuth error redirect URL:', redirectUrl);
      
      res.redirect(`${redirectUrl}/login?error=server_error&details=${encodeURIComponent(error.message)}`);
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
    
    console.log(`✅ Token refreshed for user: ${user.email}`);
    
    res.json({
      message: 'Tokens refreshed successfully',
      accessToken,  // Also return in response body for localStorage fallback
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
    // Extract token from cookies OR Authorization header (fallback for cross-subdomain issues)
    let accessToken = req.cookies.accessToken;
    
    // If no cookie token, try Authorization header
    if (!accessToken) {
      const authHeader = req.headers.authorization;
      if (authHeader && authHeader.startsWith('Bearer ')) {
        accessToken = authHeader.substring(7);
        console.log('🔑 Using token from Authorization header (cross-subdomain fallback)');
      }
    } else {
      console.log('🍪 Using token from cookies');
    }
    
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