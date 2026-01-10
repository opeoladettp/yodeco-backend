const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { getRedisClient } = require('../config/redis');
const securityLogger = require('../utils/securityLogger');

class JWTService {
  constructor() {
    this.accessTokenSecret = process.env.JWT_SECRET;
    this.refreshTokenSecret = process.env.JWT_REFRESH_SECRET;
    this.accessTokenExpiry = process.env.JWT_ACCESS_EXPIRES_IN || '15m';
    this.refreshTokenExpiry = process.env.JWT_REFRESH_EXPIRES_IN || '7d';
    
    if (!this.accessTokenSecret || !this.refreshTokenSecret) {
      throw new Error('JWT secrets must be configured in environment variables');
    }
  }

  /**
   * Generate access token with user information and role
   * @param {Object} user - User object with id, email, role
   * @returns {string} JWT access token
   */
  generateAccessToken(user) {
    const tokenId = crypto.randomUUID();
    
    const payload = {
      userId: user._id || user.id,
      email: user.email,
      role: user.role,
      tokenId,
      type: 'access'
    };

    return jwt.sign(payload, this.accessTokenSecret, {
      expiresIn: this.accessTokenExpiry,
      issuer: 'biometric-voting-portal',
      audience: 'voting-users'
    });
  }

  /**
   * Generate refresh token with token family tracking
   * @param {Object} user - User object
   * @param {string} tokenFamily - Token family ID for rotation tracking
   * @returns {string} JWT refresh token
   */
  generateRefreshToken(user, tokenFamily = null) {
    const family = tokenFamily || crypto.randomUUID();
    const tokenId = crypto.randomUUID();
    
    const payload = {
      userId: user._id || user.id,
      tokenId,
      family,
      type: 'refresh'
    };

    return jwt.sign(payload, this.refreshTokenSecret, {
      expiresIn: this.refreshTokenExpiry,
      issuer: 'biometric-voting-portal',
      audience: 'voting-users'
    });
  }

  /**
   * Generate both access and refresh tokens
   * @param {Object} user - User object
   * @param {string} tokenFamily - Optional existing token family
   * @returns {Object} Object containing accessToken, refreshToken, and tokenFamily
   */
  generateTokenPair(user, tokenFamily = null) {
    const family = tokenFamily || crypto.randomUUID();
    const accessToken = this.generateAccessToken(user);
    const refreshToken = this.generateRefreshToken(user, family);
    
    return {
      accessToken,
      refreshToken,
      tokenFamily: family
    };
  }

  /**
   * Verify access token
   * @param {string} token - JWT access token
   * @returns {Object} Decoded token payload
   */
  verifyAccessToken(token) {
    try {
      const decoded = jwt.verify(token, this.accessTokenSecret, {
        issuer: 'biometric-voting-portal',
        audience: 'voting-users'
      });
      
      if (decoded.type !== 'access') {
        throw new Error('Invalid token type');
      }
      
      return decoded;
    } catch (error) {
      throw new Error(`Invalid access token: ${error.message}`);
    }
  }

  /**
   * Verify refresh token
   * @param {string} token - JWT refresh token
   * @returns {Object} Decoded token payload
   */
  verifyRefreshToken(token) {
    try {
      const decoded = jwt.verify(token, this.refreshTokenSecret, {
        issuer: 'biometric-voting-portal',
        audience: 'voting-users'
      });
      
      if (decoded.type !== 'refresh') {
        throw new Error('Invalid token type');
      }
      
      return decoded;
    } catch (error) {
      throw new Error(`Invalid refresh token: ${error.message}`);
    }
  }

  /**
   * Check if token is blacklisted
   * @param {string} tokenId - Token ID to check
   * @returns {Promise<boolean>} True if token is blacklisted
   */
  async isTokenBlacklisted(tokenId) {
    try {
      const redis = getRedisClient();
      const result = await redis.get(`blacklist:${tokenId}`);
      return result !== null;
    } catch (error) {
      console.error('Error checking token blacklist:', error);
      // Fail secure - if we can't check blacklist, assume token is invalid
      return true;
    }
  }

  /**
   * Add token to blacklist
   * @param {string} tokenId - Token ID to blacklist
   * @param {number} ttl - Time to live in seconds
   * @param {Object} securityContext - Security context with IP, user agent, etc.
   * @returns {Promise<void>}
   */
  async blacklistToken(tokenId, ttl = 86400, securityContext = {}) {
    try {
      const redis = getRedisClient();
      await redis.setEx(`blacklist:${tokenId}`, ttl, 'revoked');
      
      // Log security event for token blacklisting
      securityLogger.logTokenBlacklist({
        tokenId,
        ttl,
        reason: securityContext.reason || 'LOGOUT',
        ...securityContext
      });
    } catch (error) {
      console.error('Error blacklisting token:', error);
      throw new Error('Failed to blacklist token');
    }
  }

  /**
   * Revoke entire token family (for reuse detection)
   * @param {string} tokenFamily - Token family to revoke
   * @param {Object} securityContext - Security context with IP, user agent, etc.
   * @returns {Promise<void>}
   */
  async revokeTokenFamily(tokenFamily, securityContext = {}) {
    try {
      const redis = getRedisClient();
      // Set family as revoked with 7 day TTL (max refresh token lifetime)
      await redis.setEx(`revoked_family:${tokenFamily}`, 604800, 'revoked');
      
      // Log security event for family revocation
      securityLogger.logTokenFamilyRevocation({
        tokenFamily,
        reason: 'TOKEN_REUSE',
        ...securityContext
      });
    } catch (error) {
      console.error('Error revoking token family:', error);
      throw new Error('Failed to revoke token family');
    }
  }

  /**
   * Check if token family is revoked
   * @param {string} tokenFamily - Token family to check
   * @returns {Promise<boolean>} True if family is revoked
   */
  async isTokenFamilyRevoked(tokenFamily) {
    try {
      const redis = getRedisClient();
      const result = await redis.get(`revoked_family:${tokenFamily}`);
      return result !== null;
    } catch (error) {
      console.error('Error checking token family revocation:', error);
      // Fail secure
      return true;
    }
  }

  /**
   * Track refresh token usage for reuse detection
   * @param {string} tokenId - Token ID
   * @param {string} tokenFamily - Token family
   * @param {Object} securityContext - Security context with IP, user agent, etc.
   * @returns {Promise<boolean>} True if token was already used
   */
  async trackTokenUsage(tokenId, tokenFamily, securityContext = {}) {
    try {
      const redis = getRedisClient();
      const key = `used_token:${tokenId}`;
      
      // Try to set the key with NX (only if not exists)
      const result = await redis.set(key, tokenFamily, 'EX', 604800, 'NX');
      
      // If result is null, key already existed (token reuse detected)
      const isReused = result === null;
      
      if (isReused) {
        // Log security event for token reuse
        securityLogger.logTokenReuse({
          tokenId,
          tokenFamily,
          ...securityContext
        });
      }
      
      return isReused;
    } catch (error) {
      console.error('Error tracking token usage:', error);
      // Fail secure - assume reuse if we can't track
      return true;
    }
  }

  /**
   * Get token expiration time from JWT
   * @param {string} token - JWT token
   * @returns {number} Expiration timestamp
   */
  getTokenExpiration(token) {
    try {
      const decoded = jwt.decode(token);
      return decoded.exp;
    } catch (error) {
      return null;
    }
  }

  /**
   * Rotate refresh token and generate new token pair
   * @param {string} oldRefreshToken - Current refresh token
   * @param {Object} user - User object
   * @param {Object} securityContext - Security context with IP, user agent, etc.
   * @returns {Promise<Object>} New token pair or null if rotation fails
   */
  async rotateTokens(oldRefreshToken, user, securityContext = {}) {
    try {
      // Verify the old refresh token
      const decoded = this.verifyRefreshToken(oldRefreshToken);
      
      // Check if token family is revoked
      const isFamilyRevoked = await this.isTokenFamilyRevoked(decoded.family);
      if (isFamilyRevoked) {
        securityLogger.logAuthFailure({
          reason: 'TOKEN_FAMILY_REVOKED',
          tokenId: decoded.tokenId,
          userId: decoded.userId,
          description: 'Attempted to use token from revoked family',
          ...securityContext
        });
        throw new Error('Token family has been revoked');
      }
      
      // Check for token reuse
      const isReused = await this.trackTokenUsage(decoded.tokenId, decoded.family, {
        userId: decoded.userId,
        ...securityContext
      });
      
      if (isReused) {
        // Token reuse detected - revoke entire family
        await this.revokeTokenFamily(decoded.family, {
          userId: decoded.userId,
          ...securityContext
        });
        throw new Error('Token reuse detected - family revoked');
      }
      
      // Generate new token pair with same family
      const newTokens = this.generateTokenPair(user, decoded.family);
      const newRefreshDecoded = this.verifyRefreshToken(newTokens.refreshToken);
      
      // Blacklist the old refresh token
      const oldTokenTTL = this.calculateTokenTTL(oldRefreshToken);
      await this.blacklistToken(decoded.tokenId, oldTokenTTL, {
        reason: 'TOKEN_ROTATION',
        userId: decoded.userId,
        ...securityContext
      });
      
      // Log successful token rotation
      securityLogger.logTokenRotation({
        userId: decoded.userId,
        tokenFamily: decoded.family,
        oldTokenId: decoded.tokenId,
        newTokenId: newRefreshDecoded.tokenId,
        ...securityContext
      });
      
      return newTokens;
    } catch (error) {
      console.error('Token rotation error:', error);
      throw error;
    }
  }

  /**
   * Set secure HTTP-only cookies for tokens
   * @param {Object} res - Express response object
   * @param {string} accessToken - JWT access token
   * @param {string} refreshToken - JWT refresh token
   */
  setTokenCookies(res, accessToken, refreshToken) {
    const isProduction = process.env.NODE_ENV === 'production';
    
    // Set access token cookie (15 minutes)
    res.cookie('accessToken', accessToken, {
      httpOnly: true,
      secure: isProduction,
      sameSite: isProduction ? 'strict' : 'lax',
      maxAge: 15 * 60 * 1000, // 15 minutes
      path: '/'
    });
    
    // Set refresh token cookie (7 days)
    res.cookie('refreshToken', refreshToken, {
      httpOnly: true,
      secure: isProduction,
      sameSite: isProduction ? 'strict' : 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
      path: '/api/auth' // Restrict refresh token to auth endpoints only
    });
  }

  /**
   * Clear token cookies
   * @param {Object} res - Express response object
   */
  clearTokenCookies(res) {
    res.clearCookie('accessToken', { path: '/' });
    res.clearCookie('refreshToken', { path: '/api/auth' });
  }

  /**
   * Calculate TTL for token blacklisting
   * @param {string} token - JWT token
   * @returns {number} TTL in seconds
   */
  calculateTokenTTL(token) {
    const exp = this.getTokenExpiration(token);
    if (!exp) return 86400; // Default 24 hours
    
    const now = Math.floor(Date.now() / 1000);
    const ttl = exp - now;
    
    return Math.max(ttl, 0);
  }
}

module.exports = new JWTService();