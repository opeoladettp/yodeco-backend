const logger = require('./logger');

/**
 * Security event logger for audit trails and security monitoring
 * Logs security-related events with structured data for analysis
 */
class SecurityLogger {
  /**
   * Log token reuse detection event
   * @param {Object} details - Event details
   */
  logTokenReuse(details) {
    const event = {
      type: 'TOKEN_REUSE_DETECTED',
      severity: 'HIGH',
      timestamp: new Date().toISOString(),
      userId: details.userId,
      tokenId: details.tokenId,
      tokenFamily: details.tokenFamily,
      ipAddress: details.ipAddress,
      userAgent: details.userAgent,
      action: 'FAMILY_REVOKED',
      description: 'Refresh token reuse detected, entire token family revoked'
    };

    logger.error('SECURITY ALERT: Token reuse detected', event);
    
    // In production, this could also send to security monitoring systems
    // like AWS CloudWatch, Datadog, or security incident response tools
    this.sendToSecurityMonitoring(event);
  }

  /**
   * Log token family revocation event
   * @param {Object} details - Event details
   */
  logTokenFamilyRevocation(details) {
    const event = {
      type: 'TOKEN_FAMILY_REVOKED',
      severity: 'HIGH',
      timestamp: new Date().toISOString(),
      userId: details.userId,
      tokenFamily: details.tokenFamily,
      reason: details.reason || 'TOKEN_REUSE',
      ipAddress: details.ipAddress,
      userAgent: details.userAgent,
      description: 'Token family revoked due to security concerns'
    };

    logger.warn('Token family revoked', event);
    this.sendToSecurityMonitoring(event);
  }

  /**
   * Log successful token rotation
   * @param {Object} details - Event details
   */
  logTokenRotation(details) {
    const event = {
      type: 'TOKEN_ROTATION_SUCCESS',
      severity: 'INFO',
      timestamp: new Date().toISOString(),
      userId: details.userId,
      tokenFamily: details.tokenFamily,
      oldTokenId: details.oldTokenId,
      newTokenId: details.newTokenId,
      ipAddress: details.ipAddress,
      userAgent: details.userAgent,
      description: 'Refresh token successfully rotated'
    };

    logger.info('Token rotation successful', event);
  }

  /**
   * Log authentication failure
   * @param {Object} details - Event details
   */
  logAuthFailure(details) {
    const event = {
      type: 'AUTH_FAILURE',
      severity: 'MEDIUM',
      timestamp: new Date().toISOString(),
      reason: details.reason,
      tokenId: details.tokenId,
      userId: details.userId,
      ipAddress: details.ipAddress,
      userAgent: details.userAgent,
      description: details.description || 'Authentication failed'
    };

    logger.warn('Authentication failure', event);
    
    // Track failed attempts for rate limiting and anomaly detection
    if (details.reason === 'INVALID_TOKEN' || details.reason === 'TOKEN_EXPIRED') {
      this.trackFailedAttempt(details.ipAddress);
    }
  }

  /**
   * Log token blacklisting event
   * @param {Object} details - Event details
   */
  logTokenBlacklist(details) {
    const event = {
      type: 'TOKEN_BLACKLISTED',
      severity: 'INFO',
      timestamp: new Date().toISOString(),
      tokenId: details.tokenId,
      userId: details.userId,
      reason: details.reason || 'LOGOUT',
      ttl: details.ttl,
      ipAddress: details.ipAddress,
      userAgent: details.userAgent,
      description: 'Token added to blacklist'
    };

    logger.info('Token blacklisted', event);
  }

  /**
   * Log suspicious activity
   * @param {Object} details - Event details
   */
  logSuspiciousActivity(details) {
    const event = {
      type: 'SUSPICIOUS_ACTIVITY',
      severity: 'HIGH',
      timestamp: new Date().toISOString(),
      activity: details.activity,
      userId: details.userId,
      ipAddress: details.ipAddress,
      userAgent: details.userAgent,
      metadata: details.metadata || {},
      description: details.description || 'Suspicious activity detected'
    };

    logger.error('SECURITY ALERT: Suspicious activity', event);
    this.sendToSecurityMonitoring(event);
  }

  /**
   * Log administrative action for audit trail
   * @param {Object} details - Event details
   */
  logAdministrativeAction(details) {
    const event = {
      type: 'ADMINISTRATIVE_ACTION',
      severity: 'INFO',
      timestamp: new Date().toISOString(),
      adminUserId: details.adminUserId,
      targetUserId: details.targetUserId,
      action: details.action,
      details: details.details || {},
      ipAddress: details.ipAddress,
      userAgent: details.userAgent,
      success: details.success !== false, // Default to true unless explicitly false
      description: details.description || `Administrative action: ${details.action}`
    };

    logger.info('Administrative action performed', event);
    
    // High-privilege actions should also go to security monitoring
    if (details.action && (
      details.action.includes('PROMOTION') || 
      details.action.includes('DEMOTION') ||
      details.action.includes('DELETE') ||
      details.action.includes('SUSPEND')
    )) {
      this.sendToSecurityMonitoring(event);
    }
  }

  /**
   * Log user role change event
   * @param {Object} details - Event details
   */
  logUserRoleChange(details) {
    const event = {
      type: 'USER_ROLE_CHANGE',
      severity: 'MEDIUM',
      timestamp: new Date().toISOString(),
      adminUserId: details.adminUserId,
      targetUserId: details.targetUserId,
      oldRole: details.oldRole,
      newRole: details.newRole,
      targetUserEmail: details.targetUserEmail,
      ipAddress: details.ipAddress,
      userAgent: details.userAgent,
      description: `User role changed from ${details.oldRole} to ${details.newRole}`
    };

    logger.warn('User role changed', event);
    this.sendToSecurityMonitoring(event);
  }

  /**
   * Track failed authentication attempts for rate limiting
   * @param {string} ipAddress - IP address of failed attempt
   */
  async trackFailedAttempt(ipAddress) {
    try {
      const { getRedisClient } = require('../config/redis');
      const redis = getRedisClient();
      
      const key = `failed_auth:${ipAddress}`;
      const count = await redis.incr(key);
      
      // Set expiry on first attempt
      if (count === 1) {
        await redis.expire(key, 3600); // 1 hour window
      }
      
      // Log if threshold exceeded
      if (count >= 10) {
        this.logSuspiciousActivity({
          activity: 'EXCESSIVE_AUTH_FAILURES',
          ipAddress,
          metadata: { failureCount: count },
          description: `${count} authentication failures from IP ${ipAddress} in the last hour`
        });
      }
    } catch (error) {
      logger.error('Failed to track authentication attempt', { error: error.message, ipAddress });
    }
  }

  /**
   * Send security events to monitoring systems
   * @param {Object} event - Security event
   */
  sendToSecurityMonitoring(event) {
    // In production, implement integration with security monitoring tools
    // Examples: AWS CloudWatch, Datadog, Splunk, ELK Stack, etc.
    
    if (process.env.NODE_ENV === 'production') {
      // Example: Send to CloudWatch
      // this.sendToCloudWatch(event);
      
      // Example: Send to security webhook
      // this.sendToSecurityWebhook(event);
      
      // For now, just ensure it's logged at the appropriate level
      if (event.severity === 'HIGH') {
        console.error(`SECURITY_ALERT: ${JSON.stringify(event)}`);
      }
    }
  }

  /**
   * Get client IP address from request
   * @param {Object} req - Express request object
   * @returns {string} IP address
   */
  getClientIP(req) {
    return req.ip || 
           req.connection?.remoteAddress || 
           req.socket?.remoteAddress || 
           req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
           'unknown';
  }

  /**
   * Get user agent from request
   * @param {Object} req - Express request object
   * @returns {string} User agent
   */
  getUserAgent(req) {
    return req.headers['user-agent'] || 'unknown';
  }

  /**
   * Create security context from request
   * @param {Object} req - Express request object
   * @returns {Object} Security context
   */
  createSecurityContext(req) {
    return {
      ipAddress: this.getClientIP(req),
      userAgent: this.getUserAgent(req),
      timestamp: new Date().toISOString()
    };
  }
}

module.exports = new SecurityLogger();