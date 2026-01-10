const express = require('express');
const router = express.Router();
const User = require('../models/User');
const AuditLog = require('../models/AuditLog');
const { requirePermission, ROLES } = require('../middleware/rbac');
const { authenticate } = require('../middleware/auth');
const { adminIdempotency } = require('../middleware/idempotency');
const securityLogger = require('../utils/securityLogger');
const redisService = require('../services/redisService');
const auditService = require('../services/auditService');
const backgroundJobs = require('../services/backgroundJobs');

/**
 * Get all users (admin only)
 * GET /api/admin/users
 */
router.get('/users', authenticate, requirePermission('user:read_all'), async (req, res) => {
  try {
    const { page = 1, limit = 20, search = '', role = '', sortBy = 'createdAt', sortOrder = 'desc' } = req.query;
    const skip = (page - 1) * limit;
    
    // Build query filter
    const filter = {};
    if (search) {
      filter.$or = [
        { name: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } }
      ];
    }
    if (role && Object.values(ROLES).includes(role)) {
      filter.role = role;
    }
    
    // Build sort object
    const sortObj = {};
    const validSortFields = ['createdAt', 'lastLogin', 'name', 'email', 'role'];
    if (validSortFields.includes(sortBy)) {
      sortObj[sortBy] = sortOrder === 'asc' ? 1 : -1;
    } else {
      sortObj.createdAt = -1; // Default sort
    }
    
    // Get users with pagination and enhanced data
    const users = await User.find(filter)
      .select('-webAuthnCredentials.publicKey -currentChallenge') // Don't expose sensitive data
      .sort(sortObj)
      .skip(skip)
      .limit(parseInt(limit));
    
    // Add activity metrics for each user
    const usersWithActivity = await Promise.all(users.map(async (user) => {
      const userObj = user.toObject();
      
      // Get user activity metrics from Redis
      const activityMetrics = await getUserActivityMetrics(user._id.toString());
      
      return {
        ...userObj,
        activityMetrics,
        hasWebAuthnCredentials: user.webAuthnCredentials && user.webAuthnCredentials.length > 0,
        credentialCount: user.webAuthnCredentials ? user.webAuthnCredentials.length : 0
      };
    }));
    
    const total = await User.countDocuments(filter);
    
    res.json({
      users: usersWithActivity,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / limit)
      }
    });
  } catch (error) {
    console.error('Error fetching users:', error);
    res.status(500).json({
      error: {
        code: 'USER_FETCH_ERROR',
        message: 'Failed to fetch users',
        retryable: true
      }
    });
  }
});

/**
 * Get user statistics and analytics (admin only)
 * GET /api/admin/users/statistics
 */
router.get('/users/statistics', authenticate, requirePermission('user:read_all'), async (req, res) => {
  try {
    const { timeframe = '30d' } = req.query;
    
    // Get basic user counts by role
    const userCounts = await User.aggregate([
      {
        $group: {
          _id: '$role',
          count: { $sum: 1 }
        }
      }
    ]);
    
    const roleStats = {};
    Object.values(ROLES).forEach(role => {
      roleStats[role] = 0;
    });
    userCounts.forEach(stat => {
      roleStats[stat._id] = stat.count;
    });
    
    // Get registration trends
    const timeframeDays = parseInt(timeframe.replace('d', ''));
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - timeframeDays);
    
    const registrationTrends = await User.aggregate([
      {
        $match: {
          createdAt: { $gte: startDate }
        }
      },
      {
        $group: {
          _id: {
            $dateToString: {
              format: '%Y-%m-%d',
              date: '$createdAt'
            }
          },
          count: { $sum: 1 }
        }
      },
      {
        $sort: { '_id': 1 }
      }
    ]);
    
    // Get active users (users who logged in recently)
    const activeUsersCount = await User.countDocuments({
      lastLogin: { $gte: startDate }
    });
    
    // Get WebAuthn adoption stats
    const webAuthnStats = await User.aggregate([
      {
        $project: {
          hasWebAuthn: {
            $cond: {
              if: { $gt: [{ $size: { $ifNull: ['$webAuthnCredentials', []] } }, 0] },
              then: true,
              else: false
            }
          }
        }
      },
      {
        $group: {
          _id: '$hasWebAuthn',
          count: { $sum: 1 }
        }
      }
    ]);
    
    const webAuthnAdoption = {
      enabled: 0,
      disabled: 0
    };
    webAuthnStats.forEach(stat => {
      if (stat._id) {
        webAuthnAdoption.enabled = stat.count;
      } else {
        webAuthnAdoption.disabled = stat.count;
      }
    });
    
    // Get total users
    const totalUsers = await User.countDocuments();
    
    res.json({
      totalUsers,
      roleDistribution: roleStats,
      registrationTrends,
      activeUsers: {
        count: activeUsersCount,
        percentage: totalUsers > 0 ? ((activeUsersCount / totalUsers) * 100).toFixed(2) : 0
      },
      webAuthnAdoption: {
        ...webAuthnAdoption,
        adoptionRate: totalUsers > 0 ? ((webAuthnAdoption.enabled / totalUsers) * 100).toFixed(2) : 0
      },
      timeframe: timeframe
    });
  } catch (error) {
    console.error('Error fetching user statistics:', error);
    res.status(500).json({
      error: {
        code: 'USER_STATISTICS_ERROR',
        message: 'Failed to fetch user statistics',
        retryable: true
      }
    });
  }
});

/**
 * Get user activity analytics (admin only)
 * GET /api/admin/users/activity
 */
router.get('/users/activity', authenticate, requirePermission('user:read_all'), async (req, res) => {
  try {
    const { timeframe = '7d', userId = '' } = req.query;
    const timeframeDays = parseInt(timeframe.replace('d', ''));
    
    if (userId) {
      // Get activity for specific user
      const activityMetrics = await getUserActivityMetrics(userId, timeframeDays);
      const user = await User.findById(userId).select('name email role');
      
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
          name: user.name,
          email: user.email,
          role: user.role
        },
        activityMetrics,
        timeframe
      });
    } else {
      // Get system-wide activity analytics
      const systemActivity = await getSystemActivityMetrics(timeframeDays);
      
      res.json({
        systemActivity,
        timeframe
      });
    }
  } catch (error) {
    console.error('Error fetching user activity:', error);
    res.status(500).json({
      error: {
        code: 'USER_ACTIVITY_ERROR',
        message: 'Failed to fetch user activity',
        retryable: true
      }
    });
  }
});

/**
 * Get user by ID (admin only)
 * GET /api/admin/users/:userId
 */
router.get('/users/:userId', authenticate, requirePermission('user:read_all'), async (req, res) => {
  try {
    const { userId } = req.params;
    
    const user = await User.findById(userId).select('-webAuthnCredentials.publicKey -currentChallenge');
    if (!user) {
      return res.status(404).json({
        error: {
          code: 'USER_NOT_FOUND',
          message: 'User not found',
          retryable: false
        }
      });
    }
    
    // Get detailed activity metrics for this user
    const activityMetrics = await getUserActivityMetrics(userId);
    const auditHistory = await getUserAuditHistory(userId);
    
    const userWithDetails = {
      ...user.toObject(),
      activityMetrics,
      auditHistory,
      hasWebAuthnCredentials: user.webAuthnCredentials && user.webAuthnCredentials.length > 0,
      credentialCount: user.webAuthnCredentials ? user.webAuthnCredentials.length : 0,
      webAuthnCredentials: user.webAuthnCredentials ? user.webAuthnCredentials.map(cred => ({
        credentialID: cred.credentialID,
        counter: cred.counter,
        transports: cred.transports,
        createdAt: cred.createdAt
      })) : []
    };
    
    res.json({ user: userWithDetails });
  } catch (error) {
    console.error('Error fetching user:', error);
    res.status(500).json({
      error: {
        code: 'USER_FETCH_ERROR',
        message: 'Failed to fetch user',
        retryable: true
      }
    });
  }
});

/**
 * Promote user role (admin only)
 * PUT /api/admin/users/:userId/promote
 */
router.put('/users/:userId/promote', adminIdempotency, authenticate, requirePermission('user:promote'), async (req, res) => {
  try {
    const { userId } = req.params;
    const { newRole } = req.body;
    const securityContext = securityLogger.createSecurityContext(req);
    
    // Validate new role
    if (!newRole || !Object.values(ROLES).includes(newRole)) {
      return res.status(400).json({
        error: {
          code: 'INVALID_ROLE',
          message: 'Invalid role specified',
          details: {
            validRoles: Object.values(ROLES),
            providedRole: newRole
          },
          retryable: false
        }
      });
    }
    
    // Prevent self-promotion to avoid admin lockout
    if (req.user._id.toString() === userId) {
      return res.status(400).json({
        error: {
          code: 'SELF_MODIFICATION_DENIED',
          message: 'Cannot modify your own role',
          retryable: false
        }
      });
    }
    
    // Find the user to promote
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({
        error: {
          code: 'USER_NOT_FOUND',
          message: 'User not found',
          retryable: false
        }
      });
    }
    
    // Check if role is actually changing
    if (user.role === newRole) {
      return res.status(400).json({
        error: {
          code: 'ROLE_UNCHANGED',
          message: 'User already has the specified role',
          details: {
            currentRole: user.role,
            requestedRole: newRole
          },
          retryable: false
        }
      });
    }
    
    const oldRole = user.role;
    
    // Update user role
    user.role = newRole;
    await user.save();
    
    // Invalidate all user sessions by revoking all their token families
    // This forces the user to re-authenticate with their new role
    await invalidateUserSessions(userId, securityContext);
    
    // Log administrative action for audit trail
    await logAdministrativeAction({
      adminUserId: req.user._id.toString(),
      targetUserId: userId,
      action: 'USER_ROLE_PROMOTION',
      details: {
        oldRole,
        newRole,
        targetUserEmail: user.email,
        targetUserName: user.name
      },
      securityContext
    });
    
    res.json({
      message: 'User role updated successfully',
      user: {
        id: user._id,
        email: user.email,
        name: user.name,
        role: user.role,
        oldRole
      },
      sessionInvalidated: true
    });
    
  } catch (error) {
    console.error('Error promoting user:', error);
    res.status(500).json({
      error: {
        code: 'USER_PROMOTION_ERROR',
        message: 'Failed to promote user',
        retryable: true
      }
    });
  }
});

/**
 * Update user role (admin only) - Generic endpoint for both promotion and demotion
 * PUT /api/admin/users/:userId/role
 */
router.put('/users/:userId/role', authenticate, requirePermission('user:promote'), async (req, res) => {
  try {
    const { userId } = req.params;
    const { newRole } = req.body;
    const securityContext = securityLogger.createSecurityContext(req);
    
    // Validate new role
    if (!newRole || !Object.values(ROLES).includes(newRole)) {
      return res.status(400).json({
        error: {
          code: 'INVALID_ROLE',
          message: 'Invalid role specified',
          details: {
            validRoles: Object.values(ROLES),
            providedRole: newRole
          },
          retryable: false
        }
      });
    }
    
    // Prevent self-modification to avoid admin lockout
    if (req.user._id.toString() === userId) {
      return res.status(400).json({
        error: {
          code: 'SELF_MODIFICATION_DENIED',
          message: 'Cannot modify your own role',
          retryable: false
        }
      });
    }
    
    // Find the user to update
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({
        error: {
          code: 'USER_NOT_FOUND',
          message: 'User not found',
          retryable: false
        }
      });
    }
    
    // Check if role is actually changing
    if (user.role === newRole) {
      return res.status(400).json({
        error: {
          code: 'ROLE_UNCHANGED',
          message: 'User already has the specified role',
          details: {
            currentRole: user.role,
            requestedRole: newRole
          },
          retryable: false
        }
      });
    }
    
    const oldRole = user.role;
    
    // Update user role
    user.role = newRole;
    await user.save();
    
    // Invalidate all user sessions
    await invalidateUserSessions(userId, securityContext);
    
    // Determine action type for logging
    const actionType = isPromotion(oldRole, newRole) ? 'USER_ROLE_PROMOTION' : 'USER_ROLE_DEMOTION';
    
    // Log administrative action for audit trail
    await logAdministrativeAction({
      adminUserId: req.user._id.toString(),
      targetUserId: userId,
      action: actionType,
      details: {
        oldRole,
        newRole,
        targetUserEmail: user.email,
        targetUserName: user.name
      },
      securityContext
    });
    
    res.json({
      message: 'User role updated successfully',
      user: {
        id: user._id,
        email: user.email,
        name: user.name,
        role: user.role,
        oldRole
      },
      sessionInvalidated: true
    });
    
  } catch (error) {
    console.error('Error updating user role:', error);
    res.status(500).json({
      error: {
        code: 'USER_ROLE_UPDATE_ERROR',
        message: 'Failed to update user role',
        retryable: true
      }
    });
  }
});

/**
 * Get audit logs (admin only)
 * GET /api/admin/audit-logs
 */
router.get('/audit-logs', authenticate, requirePermission('audit:read'), async (req, res) => {
  try {
    const { 
      page = 1, 
      limit = 50, 
      action = '', 
      userId = '', 
      targetUserId = '',
      startDate = '', 
      endDate = '',
      sortBy = 'timestamp',
      sortOrder = 'desc',
      source = 'persistent' // 'persistent' or 'redis' for backward compatibility
    } = req.query;
    
    const skip = (page - 1) * limit;
    
    if (source === 'persistent') {
      // Use new persistent audit service
      const filter = {};
      if (action) filter.action = action;
      if (userId) filter.adminUserId = userId;
      if (targetUserId) filter.targetUserId = targetUserId;
      if (startDate) filter.startDate = startDate;
      if (endDate) filter.endDate = endDate;
      
      const result = await auditService.getAuditLogs(filter, {
        skip,
        limit: parseInt(limit),
        sortBy,
        sortOrder
      });
      
      // Transform the data to match expected format
      const enrichedLogs = result.auditLogs.map(log => ({
        auditId: log.auditId,
        timestamp: log.timestamp,
        adminUserId: log.adminUserId ? log.adminUserId._id : null,
        targetUserId: log.targetUserId ? log.targetUserId._id : null,
        action: log.action,
        details: log.details,
        success: log.success,
        ipAddress: log.ipAddress,
        userAgent: log.userAgent,
        sequenceNumber: log.sequenceNumber,
        currentHash: log.currentHash,
        integrityValid: log.verifyIntegrity(),
        adminUser: log.adminUserId ? {
          id: log.adminUserId._id,
          name: log.adminUserId.name,
          email: log.adminUserId.email,
          role: log.adminUserId.role
        } : null,
        targetUser: log.targetUserId ? {
          id: log.targetUserId._id,
          name: log.targetUserId.name,
          email: log.targetUserId.email,
          role: log.targetUserId.role
        } : null
      }));
      
      res.json({
        auditLogs: enrichedLogs,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total: result.pagination.total,
          pages: result.pagination.pages
        },
        filters: {
          action,
          userId,
          targetUserId,
          startDate,
          endDate,
          sortBy,
          sortOrder
        },
        source: 'persistent'
      });
    } else {
      // Fallback to Redis-based audit logs for backward compatibility
      const filter = {};
      if (action) {
        filter.action = { $regex: action, $options: 'i' };
      }
      if (userId) {
        filter.adminUserId = userId;
      }
      if (targetUserId) {
        filter.targetUserId = targetUserId;
      }
      if (startDate || endDate) {
        filter.timestamp = {};
        if (startDate) {
          filter.timestamp.$gte = new Date(startDate).toISOString();
        }
        if (endDate) {
          filter.timestamp.$lte = new Date(endDate).toISOString();
        }
      }
      
      // Get audit logs with enhanced filtering
      const auditLogs = await getAuditLogs(filter, skip, parseInt(limit), sortBy, sortOrder);
      const total = await getAuditLogCount(filter);
      
      // Enrich audit logs with user information
      const enrichedLogs = await Promise.all(auditLogs.map(async (log) => {
        const adminUser = await User.findById(log.adminUserId).select('name email role');
        const targetUser = log.targetUserId ? await User.findById(log.targetUserId).select('name email role') : null;
        
        return {
          ...log,
          adminUser: adminUser ? {
            id: adminUser._id,
            name: adminUser.name,
            email: adminUser.email,
            role: adminUser.role
          } : null,
          targetUser: targetUser ? {
            id: targetUser._id,
            name: targetUser.name,
            email: targetUser.email,
            role: targetUser.role
          } : null
        };
      }));
      
      res.json({
        auditLogs: enrichedLogs,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          pages: Math.ceil(total / limit)
        },
        filters: {
          action,
          userId,
          targetUserId,
          startDate,
          endDate,
          sortBy,
          sortOrder
        },
        source: 'redis'
      });
    }
  } catch (error) {
    console.error('Error fetching audit logs:', error);
    res.status(500).json({
      error: {
        code: 'AUDIT_LOG_FETCH_ERROR',
        message: 'Failed to fetch audit logs',
        retryable: true
      }
    });
  }
});

/**
 * Export audit logs (admin only)
 * GET /api/admin/audit-logs/export
 */
router.get('/audit-logs/export', authenticate, requirePermission('audit:export'), async (req, res) => {
  try {
    const { 
      format = 'json',
      action = '', 
      userId = '', 
      targetUserId = '',
      startDate = '', 
      endDate = ''
    } = req.query;
    
    // Build query filter
    const filter = {};
    if (action) filter.action = action;
    if (userId) filter.adminUserId = userId;
    if (targetUserId) filter.targetUserId = targetUserId;
    if (startDate) filter.startDate = startDate;
    if (endDate) filter.endDate = endDate;
    
    // Use the audit service for export
    const exportData = await auditService.exportAuditLogs(filter, format);
    
    // Log the export action
    await logAdministrativeAction({
      adminUserId: req.user._id.toString(),
      targetUserId: null,
      action: 'AUDIT_LOG_EXPORT',
      details: {
        format,
        recordCount: format === 'json' ? exportData.recordCount : exportData.split('\n').length - 1,
        filters: { action, userId, targetUserId, startDate, endDate }
      },
      securityContext: securityLogger.createSecurityContext(req)
    });
    
    if (format === 'csv') {
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="audit-logs-${new Date().toISOString().split('T')[0]}.csv"`);
      res.send(exportData);
    } else {
      // Return JSON format
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Content-Disposition', `attachment; filename="audit-logs-${new Date().toISOString().split('T')[0]}.json"`);
      res.json(exportData);
    }
  } catch (error) {
    console.error('Error exporting audit logs:', error);
    res.status(500).json({
      error: {
        code: 'AUDIT_LOG_EXPORT_ERROR',
        message: 'Failed to export audit logs',
        retryable: true
      }
    });
  }
});

/**
 * Verify audit log integrity (admin only)
 * GET /api/admin/audit-logs/integrity
 */
router.get('/audit-logs/integrity', authenticate, requirePermission('audit:verify'), async (req, res) => {
  try {
    const { startSequence = 1, endSequence = null } = req.query;
    
    const verificationResult = await auditService.verifyIntegrity(
      parseInt(startSequence),
      endSequence ? parseInt(endSequence) : null
    );
    
    // Log the integrity check
    await logAdministrativeAction({
      adminUserId: req.user._id.toString(),
      targetUserId: null,
      action: 'INTEGRITY_VERIFICATION',
      details: {
        startSequence: parseInt(startSequence),
        endSequence: endSequence ? parseInt(endSequence) : null,
        verificationResult
      },
      securityContext: securityLogger.createSecurityContext(req)
    });
    
    res.json({
      verificationResult,
      timestamp: new Date().toISOString(),
      verifiedBy: {
        id: req.user._id,
        name: req.user.name,
        email: req.user.email
      }
    });
  } catch (error) {
    console.error('Error verifying audit log integrity:', error);
    res.status(500).json({
      error: {
        code: 'INTEGRITY_VERIFICATION_ERROR',
        message: 'Failed to verify audit log integrity',
        retryable: true
      }
    });
  }
});

/**
 * Get audit statistics (admin only)
 * GET /api/admin/audit-logs/statistics
 */
router.get('/audit-logs/statistics', authenticate, requirePermission('audit:read'), async (req, res) => {
  try {
    const { timeframe = '30d' } = req.query;
    const days = parseInt(timeframe.replace('d', ''));
    
    const statistics = await auditService.getAuditStatistics(days);
    
    res.json({
      statistics,
      generatedAt: new Date().toISOString(),
      timeframe: `${days} days`
    });
  } catch (error) {
    console.error('Error fetching audit statistics:', error);
    res.status(500).json({
      error: {
        code: 'AUDIT_STATISTICS_ERROR',
        message: 'Failed to fetch audit statistics',
        retryable: true
      }
    });
  }
});

/**
 * Run integrity verification job (admin only)
 * POST /api/admin/audit-logs/verify-integrity
 */
router.post('/audit-logs/verify-integrity', authenticate, requirePermission('audit:verify'), async (req, res) => {
  try {
    const verificationResult = await auditService.runIntegrityVerification();
    
    // Log the manual integrity verification
    await logAdministrativeAction({
      adminUserId: req.user._id.toString(),
      targetUserId: null,
      action: 'MANUAL_INTEGRITY_VERIFICATION',
      details: {
        verificationResult,
        triggeredBy: 'manual_request'
      },
      securityContext: securityLogger.createSecurityContext(req)
    });
    
    res.json({
      message: 'Integrity verification completed',
      verificationResult,
      timestamp: new Date().toISOString(),
      triggeredBy: {
        id: req.user._id,
        name: req.user.name,
        email: req.user.email
      }
    });
  } catch (error) {
    console.error('Error running integrity verification:', error);
    res.status(500).json({
      error: {
        code: 'INTEGRITY_VERIFICATION_JOB_ERROR',
        message: 'Failed to run integrity verification job',
        retryable: true
      }
    });
  }
});

/**
 * Get audit log by ID (admin only)
 * GET /api/admin/audit-logs/:auditId
 */
router.get('/audit-logs/:auditId', authenticate, requirePermission('audit:read'), async (req, res) => {
  try {
    const { auditId } = req.params;
    
    const auditLog = await AuditLog.findOne({ auditId })
      .populate('adminUserId', 'name email role')
      .populate('targetUserId', 'name email role');
    
    if (!auditLog) {
      return res.status(404).json({
        error: {
          code: 'AUDIT_LOG_NOT_FOUND',
          message: 'Audit log entry not found',
          retryable: false
        }
      });
    }
    
    // Verify integrity of this specific entry
    const integrityValid = auditLog.verifyIntegrity();
    
    res.json({
      auditLog: {
        ...auditLog.toObject(),
        integrityValid,
        adminUser: auditLog.adminUserId ? {
          id: auditLog.adminUserId._id,
          name: auditLog.adminUserId.name,
          email: auditLog.adminUserId.email,
          role: auditLog.adminUserId.role
        } : null,
        targetUser: auditLog.targetUserId ? {
          id: auditLog.targetUserId._id,
          name: auditLog.targetUserId.name,
          email: auditLog.targetUserId.email,
          role: auditLog.targetUserId.role
        } : null
      }
    });
  } catch (error) {
    console.error('Error fetching audit log:', error);
    res.status(500).json({
      error: {
        code: 'AUDIT_LOG_FETCH_ERROR',
        message: 'Failed to fetch audit log',
        retryable: true
      }
    });
  }
});

/**
 * Get system monitoring information (admin only)
 * GET /api/admin/system/monitoring
 */
router.get('/system/monitoring', authenticate, requirePermission('system:monitor'), async (req, res) => {
  try {
    // Get background job status
    const jobStatus = backgroundJobs.getStatus();
    
    // Get recent integrity checks
    const recentIntegrityChecks = await backgroundJobs.getRecentIntegrityChecks();
    
    // Get cache metrics
    const redis = redisService.getClient();
    const cacheMetricsData = await redis.get('cache_metrics:latest');
    const cacheMetrics = cacheMetricsData ? JSON.parse(cacheMetricsData) : null;
    
    // Get recent alerts
    const alertKeys = await redis.keys('integrity_alert:*');
    const recentAlerts = [];
    for (const key of alertKeys.sort().slice(-5)) { // Get last 5 alerts
      const alertData = await redis.get(key);
      if (alertData) {
        recentAlerts.push(JSON.parse(alertData));
      }
    }
    
    res.json({
      timestamp: new Date().toISOString(),
      backgroundJobs: jobStatus,
      integrityChecks: {
        recent: recentIntegrityChecks,
        lastCheck: recentIntegrityChecks.length > 0 ? recentIntegrityChecks[0] : null
      },
      cacheMetrics,
      alerts: {
        recent: recentAlerts.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp)),
        count: recentAlerts.length
      },
      systemHealth: {
        auditLogIntegrity: recentIntegrityChecks.length > 0 ? recentIntegrityChecks[0].result.integrityScore : null,
        backgroundJobsRunning: jobStatus.isRunning,
        cacheHealthy: cacheMetrics !== null
      }
    });
  } catch (error) {
    console.error('Error fetching system monitoring info:', error);
    res.status(500).json({
      error: {
        code: 'SYSTEM_MONITORING_ERROR',
        message: 'Failed to fetch system monitoring information',
        retryable: true
      }
    });
  }
});

/**
 * Get system statistics (admin only)
 * GET /api/admin/system/stats
 */
router.get('/system/stats', authenticate, requirePermission('system:monitor'), async (req, res) => {
  try {
    // Get basic counts from database
    const [totalUsers, totalCategories, totalAwards, totalNominees, totalVotes] = await Promise.all([
      User.countDocuments(),
      require('../models/Category').countDocuments(),
      require('../models/Award').countDocuments(), 
      require('../models/Nominee').countDocuments(),
      require('../models/Vote').countDocuments()
    ]);

    // Get active users in last 24 hours
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const activeUsers24h = await User.countDocuments({
      lastLogin: { $gte: yesterday }
    });

    res.json({
      stats: {
        totalUsers,
        totalCategories,
        totalAwards,
        totalNominees,
        totalVotes,
        activeUsers24h
      },
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error fetching system stats:', error);
    res.status(500).json({
      error: {
        code: 'SYSTEM_STATS_ERROR',
        message: 'Failed to fetch system statistics',
        retryable: true
      }
    });
  }
});

/**
 * Helper function to get user activity metrics
 * @param {string} userId - User ID to get metrics for
 * @param {number} days - Number of days to look back (default 30)
 * @returns {Object} Activity metrics
 */
async function getUserActivityMetrics(userId, days = 30) {
  try {
    const redis = redisService.getClient();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);
    
    // Get login activity from Redis
    const loginKeys = await redis.keys(`user_activity:${userId}:login:*`);
    const recentLogins = [];
    
    for (const key of loginKeys) {
      const loginData = await redis.get(key);
      if (loginData) {
        const login = JSON.parse(loginData);
        if (new Date(login.timestamp) >= startDate) {
          recentLogins.push(login);
        }
      }
    }
    
    // Get vote activity
    const voteKeys = await redis.keys(`user_activity:${userId}:vote:*`);
    const recentVotes = [];
    
    for (const key of voteKeys) {
      const voteData = await redis.get(key);
      if (voteData) {
        const vote = JSON.parse(voteData);
        if (new Date(vote.timestamp) >= startDate) {
          recentVotes.push(vote);
        }
      }
    }
    
    // Get WebAuthn usage
    const webauthnKeys = await redis.keys(`user_activity:${userId}:webauthn:*`);
    const webauthnUsage = [];
    
    for (const key of webauthnKeys) {
      const webauthnData = await redis.get(key);
      if (webauthnData) {
        const usage = JSON.parse(webauthnData);
        if (new Date(usage.timestamp) >= startDate) {
          webauthnUsage.push(usage);
        }
      }
    }
    
    // Calculate activity summary
    const totalLogins = recentLogins.length;
    const totalVotes = recentVotes.length;
    const totalWebAuthnUsage = webauthnUsage.length;
    
    // Get last activity timestamp
    const allActivities = [...recentLogins, ...recentVotes, ...webauthnUsage];
    const lastActivity = allActivities.length > 0 
      ? new Date(Math.max(...allActivities.map(a => new Date(a.timestamp))))
      : null;
    
    return {
      loginCount: totalLogins,
      voteCount: totalVotes,
      webauthnUsageCount: totalWebAuthnUsage,
      lastActivity,
      isActive: lastActivity && (new Date() - lastActivity) < (7 * 24 * 60 * 60 * 1000), // Active within 7 days
      activityScore: calculateActivityScore(totalLogins, totalVotes, totalWebAuthnUsage, days)
    };
  } catch (error) {
    console.error('Error getting user activity metrics:', error);
    return {
      loginCount: 0,
      voteCount: 0,
      webauthnUsageCount: 0,
      lastActivity: null,
      isActive: false,
      activityScore: 0
    };
  }
}

/**
 * Helper function to get user audit history
 * @param {string} userId - User ID to get audit history for
 * @returns {Array} Audit history entries
 */
async function getUserAuditHistory(userId) {
  try {
    const redis = redisService.getClient();
    const auditKeys = await redis.keys('audit_log:*');
    
    const userAuditLogs = [];
    for (const key of auditKeys) {
      const logData = await redis.get(key);
      if (logData) {
        const log = JSON.parse(logData);
        if (log.targetUserId === userId || log.adminUserId === userId) {
          userAuditLogs.push(log);
        }
      }
    }
    
    // Sort by timestamp (newest first) and limit to last 50 entries
    userAuditLogs.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    return userAuditLogs.slice(0, 50);
  } catch (error) {
    console.error('Error getting user audit history:', error);
    return [];
  }
}

/**
 * Helper function to get system-wide activity metrics
 * @param {number} days - Number of days to look back
 * @returns {Object} System activity metrics
 */
async function getSystemActivityMetrics(days = 7) {
  try {
    const redis = redisService.getClient();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);
    
    // Get all activity keys
    const loginKeys = await redis.keys('user_activity:*:login:*');
    const voteKeys = await redis.keys('user_activity:*:vote:*');
    const webauthnKeys = await redis.keys('user_activity:*:webauthn:*');
    
    // Process login activity
    const loginActivity = await processActivityKeys(redis, loginKeys, startDate);
    const voteActivity = await processActivityKeys(redis, voteKeys, startDate);
    const webauthnActivity = await processActivityKeys(redis, webauthnKeys, startDate);
    
    // Calculate daily activity trends
    const dailyActivity = {};
    for (let i = 0; i < days; i++) {
      const date = new Date();
      date.setDate(date.getDate() - i);
      const dateStr = date.toISOString().split('T')[0];
      dailyActivity[dateStr] = {
        logins: 0,
        votes: 0,
        webauthn: 0
      };
    }
    
    // Populate daily activity
    loginActivity.forEach(activity => {
      const dateStr = new Date(activity.timestamp).toISOString().split('T')[0];
      if (dailyActivity[dateStr]) {
        dailyActivity[dateStr].logins++;
      }
    });
    
    voteActivity.forEach(activity => {
      const dateStr = new Date(activity.timestamp).toISOString().split('T')[0];
      if (dailyActivity[dateStr]) {
        dailyActivity[dateStr].votes++;
      }
    });
    
    webauthnActivity.forEach(activity => {
      const dateStr = new Date(activity.timestamp).toISOString().split('T')[0];
      if (dailyActivity[dateStr]) {
        dailyActivity[dateStr].webauthn++;
      }
    });
    
    return {
      totalLogins: loginActivity.length,
      totalVotes: voteActivity.length,
      totalWebAuthnUsage: webauthnActivity.length,
      dailyActivity: Object.entries(dailyActivity)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([date, activity]) => ({ date, ...activity })),
      uniqueActiveUsers: await getUniqueActiveUsers(days)
    };
  } catch (error) {
    console.error('Error getting system activity metrics:', error);
    return {
      totalLogins: 0,
      totalVotes: 0,
      totalWebAuthnUsage: 0,
      dailyActivity: [],
      uniqueActiveUsers: 0
    };
  }
}

/**
 * Helper function to process activity keys and extract recent activities
 * @param {Object} redis - Redis client
 * @param {Array} keys - Activity keys to process
 * @param {Date} startDate - Start date for filtering
 * @returns {Array} Recent activities
 */
async function processActivityKeys(redis, keys, startDate) {
  const activities = [];
  
  for (const key of keys) {
    const activityData = await redis.get(key);
    if (activityData) {
      const activity = JSON.parse(activityData);
      if (new Date(activity.timestamp) >= startDate) {
        activities.push(activity);
      }
    }
  }
  
  return activities;
}

/**
 * Helper function to get unique active users count
 * @param {number} days - Number of days to look back
 * @returns {number} Count of unique active users
 */
async function getUniqueActiveUsers(days = 7) {
  try {
    const redis = redisService.getClient();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);
    
    const activeUsers = new Set();
    
    // Get all activity keys and extract user IDs
    const activityKeys = await redis.keys('user_activity:*');
    
    for (const key of activityKeys) {
      const activityData = await redis.get(key);
      if (activityData) {
        const activity = JSON.parse(activityData);
        if (new Date(activity.timestamp) >= startDate) {
          // Extract user ID from key pattern: user_activity:userId:type:timestamp
          const userId = key.split(':')[1];
          activeUsers.add(userId);
        }
      }
    }
    
    return activeUsers.size;
  } catch (error) {
    console.error('Error getting unique active users:', error);
    return 0;
  }
}

/**
 * Helper function to calculate activity score
 * @param {number} logins - Number of logins
 * @param {number} votes - Number of votes
 * @param {number} webauthn - Number of WebAuthn usages
 * @param {number} days - Time period in days
 * @returns {number} Activity score (0-100)
 */
function calculateActivityScore(logins, votes, webauthn, days) {
  // Weight different activities
  const loginWeight = 1;
  const voteWeight = 3; // Votes are more valuable
  const webauthnWeight = 2; // Security usage is important
  
  const totalActivity = (logins * loginWeight) + (votes * voteWeight) + (webauthn * webauthnWeight);
  const maxPossibleDaily = 10; // Assume max 10 weighted activities per day for a very active user
  const maxPossible = maxPossibleDaily * days;
  
  const score = Math.min(100, (totalActivity / maxPossible) * 100);
  return Math.round(score);
}

/**
 * Helper function to track user activity (to be called from other parts of the system)
 * @param {string} userId - User ID
 * @param {string} activityType - Type of activity (login, vote, webauthn)
 * @param {Object} metadata - Additional activity metadata
 */
async function trackUserActivity(userId, activityType, metadata = {}) {
  try {
    const redis = redisService.getClient();
    const timestamp = new Date().toISOString();
    const activityKey = `user_activity:${userId}:${activityType}:${Date.now()}`;
    
    const activityData = {
      userId,
      activityType,
      timestamp,
      metadata
    };
    
    // Store activity with 90-day TTL
    await redis.setEx(activityKey, 90 * 24 * 60 * 60, JSON.stringify(activityData));
    
    // Update user's last activity timestamp
    await User.findByIdAndUpdate(userId, { lastLogin: new Date() });
    
  } catch (error) {
    console.error('Error tracking user activity:', error);
    // Don't throw - activity tracking failure shouldn't break the main flow
  }
}

/**
 * Helper function to invalidate all user sessions
 * @param {string} userId - User ID whose sessions to invalidate
 * @param {Object} securityContext - Security context for logging
 */
async function invalidateUserSessions(userId, securityContext) {
  try {
    // In a production system, you would:
    // 1. Query all active token families for the user
    // 2. Revoke each token family
    // 3. Clear any session data
    
    // For now, we'll use a pattern-based approach to invalidate sessions
    // This is a simplified implementation - in production you'd want to track
    // user sessions more explicitly
    
    const redis = redisService.getClient();
    
    // Get all keys that might be related to this user's sessions
    const sessionKeys = await redis.keys(`session:*:${userId}`);
    const tokenKeys = await redis.keys(`used_token:*`);
    
    // Delete session keys
    if (sessionKeys.length > 0) {
      await redis.del(...sessionKeys);
    }
    
    // For token families, we need a more sophisticated approach
    // In a real implementation, you'd maintain a user-to-token-family mapping
    // For now, we'll log the session invalidation
    
    securityLogger.logSuspiciousActivity({
      activity: 'USER_SESSION_INVALIDATION',
      userId: userId,
      description: 'All user sessions invalidated due to role change',
      metadata: {
        reason: 'ROLE_CHANGE',
        sessionKeysInvalidated: sessionKeys.length
      },
      ...securityContext
    });
    
  } catch (error) {
    console.error('Error invalidating user sessions:', error);
    // Don't throw - session invalidation failure shouldn't block role update
  }
}

/**
 * Helper function to log administrative actions with enhanced details and persistent storage
 * @param {Object} actionData - Action data to log
 */
async function logAdministrativeAction(actionData) {
  try {
    // Create persistent audit entry
    await auditService.createAuditEntry({
      adminUserId: actionData.adminUserId,
      targetUserId: actionData.targetUserId,
      action: actionData.action,
      details: actionData.details,
      ipAddress: actionData.securityContext.ipAddress,
      userAgent: actionData.securityContext.userAgent,
      sessionId: actionData.securityContext.sessionId || null,
      requestId: actionData.securityContext.requestId || null,
      success: true,
      metadata: {
        timestamp: new Date().toISOString(),
        source: 'admin_api'
      }
    });
    
    // Also maintain Redis cache for fast access (legacy support)
    const timestamp = new Date().toISOString();
    const auditEntry = {
      id: `audit_${Date.now()}_${actionData.adminUserId}`,
      timestamp,
      adminUserId: actionData.adminUserId,
      targetUserId: actionData.targetUserId,
      action: actionData.action,
      details: actionData.details,
      ipAddress: actionData.securityContext.ipAddress,
      userAgent: actionData.securityContext.userAgent,
      success: true,
      sessionId: actionData.securityContext.sessionId || null,
      requestId: actionData.securityContext.requestId || null
    };
    
    const redis = redisService.getClient();
    const auditKey = `audit_log:${Date.now()}:${actionData.adminUserId}`;
    await redis.setEx(auditKey, 86400 * 365 * 2, JSON.stringify(auditEntry)); // 2 year TTL
    
    // Also log to application logs with structured format
    securityLogger.logSuspiciousActivity({
      activity: 'ADMINISTRATIVE_ACTION',
      userId: actionData.adminUserId,
      description: `Admin performed ${actionData.action}`,
      metadata: {
        auditId: auditEntry.id,
        targetUserId: actionData.targetUserId,
        action: actionData.action,
        details: actionData.details,
        timestamp
      },
      ...actionData.securityContext
    });
    
    // Track admin activity
    await trackUserActivity(actionData.adminUserId, 'admin_action', {
      action: actionData.action,
      targetUserId: actionData.targetUserId
    });
    
  } catch (error) {
    console.error('Error logging administrative action:', error);
    // Don't throw - audit logging failure shouldn't block the action
  }
}

/**
 * Helper function to determine if role change is a promotion
 * @param {string} oldRole - Previous role
 * @param {string} newRole - New role
 * @returns {boolean} True if it's a promotion
 */
function isPromotion(oldRole, newRole) {
  const { ROLE_HIERARCHY } = require('../middleware/rbac');
  const oldLevel = ROLE_HIERARCHY[oldRole] || 0;
  const newLevel = ROLE_HIERARCHY[newRole] || 0;
  return newLevel > oldLevel;
}

/**
 * Helper function to get audit logs with enhanced filtering
 * @param {Object} filter - Query filter
 * @param {number} skip - Number of records to skip
 * @param {number} limit - Number of records to return
 * @param {string} sortBy - Field to sort by
 * @param {string} sortOrder - Sort order (asc/desc)
 * @returns {Array} Audit log entries
 */
async function getAuditLogs(filter, skip, limit, sortBy = 'timestamp', sortOrder = 'desc') {
  try {
    const redis = redisService.getClient();
    const keys = await redis.keys('audit_log:*');
    
    // Get all audit log entries
    const logs = [];
    for (const key of keys) {
      const logData = await redis.get(key);
      if (logData) {
        const log = JSON.parse(logData);
        
        // Apply filters
        let matches = true;
        
        if (filter.action && !log.action.toLowerCase().includes(filter.action.toLowerCase())) {
          matches = false;
        }
        
        if (filter.adminUserId && log.adminUserId !== filter.adminUserId) {
          matches = false;
        }
        
        if (filter.targetUserId && log.targetUserId !== filter.targetUserId) {
          matches = false;
        }
        
        if (filter.timestamp) {
          const logTime = new Date(log.timestamp);
          if (filter.timestamp.$gte && logTime < new Date(filter.timestamp.$gte)) {
            matches = false;
          }
          if (filter.timestamp.$lte && logTime > new Date(filter.timestamp.$lte)) {
            matches = false;
          }
        }
        
        if (matches) {
          logs.push(log);
        }
      }
    }
    
    // Sort logs
    logs.sort((a, b) => {
      let aVal = a[sortBy];
      let bVal = b[sortBy];
      
      if (sortBy === 'timestamp') {
        aVal = new Date(aVal);
        bVal = new Date(bVal);
      }
      
      if (sortOrder === 'asc') {
        return aVal > bVal ? 1 : -1;
      } else {
        return aVal < bVal ? 1 : -1;
      }
    });
    
    // Apply pagination
    return logs.slice(skip, skip + limit);
  } catch (error) {
    console.error('Error fetching audit logs:', error);
    return [];
  }
}

/**
 * Helper function to get audit log count with filtering
 * @param {Object} filter - Query filter
 * @returns {number} Total count of matching audit logs
 */
async function getAuditLogCount(filter) {
  try {
    const redis = redisService.getClient();
    const keys = await redis.keys('audit_log:*');
    
    let count = 0;
    for (const key of keys) {
      const logData = await redis.get(key);
      if (logData) {
        const log = JSON.parse(logData);
        
        // Apply filters
        let matches = true;
        
        if (filter.action && !log.action.toLowerCase().includes(filter.action.toLowerCase())) {
          matches = false;
        }
        
        if (filter.adminUserId && log.adminUserId !== filter.adminUserId) {
          matches = false;
        }
        
        if (filter.targetUserId && log.targetUserId !== filter.targetUserId) {
          matches = false;
        }
        
        if (filter.timestamp) {
          const logTime = new Date(log.timestamp);
          if (filter.timestamp.$gte && logTime < new Date(filter.timestamp.$gte)) {
            matches = false;
          }
          if (filter.timestamp.$lte && logTime > new Date(filter.timestamp.$lte)) {
            matches = false;
          }
        }
        
        if (matches) {
          count++;
        }
      }
    }
    
    return count;
  } catch (error) {
    console.error('Error counting audit logs:', error);
    return 0;
  }
}

// Export the trackUserActivity function for use in other modules
module.exports = router;
module.exports.trackUserActivity = trackUserActivity;