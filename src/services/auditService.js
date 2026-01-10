const AuditLog = require('../models/AuditLog');
const redisService = require('./redisService');
const securityLogger = require('../utils/securityLogger');
const crypto = require('crypto');

class AuditService {
  /**
   * Create a new audit log entry with hash chaining
   * @param {Object} auditData - Audit data to log
   * @returns {Promise<Object>} Created audit log entry
   */
  async createAuditEntry(auditData) {
    try {
      const auditId = `audit_${Date.now()}_${crypto.randomUUID()}`;
      
      const auditEntry = new AuditLog({
        auditId,
        timestamp: new Date(),
        adminUserId: auditData.adminUserId,
        targetUserId: auditData.targetUserId || null,
        action: auditData.action,
        details: auditData.details || {},
        ipAddress: auditData.ipAddress,
        userAgent: auditData.userAgent || '',
        sessionId: auditData.sessionId || null,
        requestId: auditData.requestId || null,
        success: auditData.success !== undefined ? auditData.success : true,
        errorDetails: auditData.errorDetails || null,
        metadata: auditData.metadata || {}
      });
      
      // Save to MongoDB (hash chaining happens in pre-save middleware)
      await auditEntry.save();
      
      // Also cache in Redis for fast access
      const redis = redisService.getClient();
      const cacheKey = `audit_cache:${auditEntry.auditId}`;
      await redis.setEx(cacheKey, 86400 * 7, JSON.stringify(auditEntry.toObject())); // 7 day cache
      
      // Update daily index
      const dateKey = auditEntry.timestamp.toISOString().split('T')[0];
      const dailyIndexKey = `audit_daily:${dateKey}`;
      await redis.sAdd(dailyIndexKey, auditEntry.auditId);
      await redis.expire(dailyIndexKey, 86400 * 365); // 1 year TTL
      
      // Update user-specific index
      if (auditData.targetUserId) {
        const userAuditKey = `user_audit_persistent:${auditData.targetUserId}`;
        await redis.lPush(userAuditKey, auditEntry.auditId);
        await redis.lTrim(userAuditKey, 0, 999); // Keep last 1000 entries
        await redis.expire(userAuditKey, 86400 * 365); // 1 year TTL
      }
      
      return auditEntry;
    } catch (error) {
      console.error('Error creating audit entry:', error);
      
      // Log the failure but don't throw - audit failures shouldn't break main operations
      securityLogger.logSuspiciousActivity({
        activity: 'AUDIT_LOG_FAILURE',
        userId: auditData.adminUserId,
        description: 'Failed to create audit log entry',
        metadata: {
          error: error.message,
          auditData
        },
        ipAddress: auditData.ipAddress,
        userAgent: auditData.userAgent
      });
      
      return null;
    }
  }
  
  /**
   * Get audit logs with filtering and pagination
   * @param {Object} filter - Query filter
   * @param {Object} options - Query options (skip, limit, sort)
   * @returns {Promise<Object>} Audit logs and metadata
   */
  async getAuditLogs(filter = {}, options = {}) {
    try {
      const {
        skip = 0,
        limit = 50,
        sortBy = 'timestamp',
        sortOrder = 'desc'
      } = options;
      
      // Build MongoDB query
      const query = {};
      
      if (filter.action) {
        query.action = { $regex: filter.action, $options: 'i' };
      }
      
      if (filter.adminUserId) {
        query.adminUserId = filter.adminUserId;
      }
      
      if (filter.targetUserId) {
        query.targetUserId = filter.targetUserId;
      }
      
      if (filter.startDate || filter.endDate) {
        query.timestamp = {};
        if (filter.startDate) {
          query.timestamp.$gte = new Date(filter.startDate);
        }
        if (filter.endDate) {
          query.timestamp.$lte = new Date(filter.endDate);
        }
      }
      
      if (filter.success !== undefined) {
        query.success = filter.success;
      }
      
      // Build sort object
      const sort = {};
      sort[sortBy] = sortOrder === 'asc' ? 1 : -1;
      
      // Execute query
      const auditLogs = await AuditLog.find(query)
        .populate('adminUserId', 'name email role')
        .populate('targetUserId', 'name email role')
        .sort(sort)
        .skip(skip)
        .limit(limit);
      
      const total = await AuditLog.countDocuments(query);
      
      return {
        auditLogs,
        pagination: {
          total,
          skip,
          limit,
          pages: Math.ceil(total / limit)
        }
      };
    } catch (error) {
      console.error('Error fetching audit logs:', error);
      throw error;
    }
  }
  
  /**
   * Verify integrity of audit log chain
   * @param {number} startSequence - Starting sequence number
   * @param {number} endSequence - Ending sequence number (optional)
   * @returns {Promise<Object>} Integrity verification results
   */
  async verifyIntegrity(startSequence = 1, endSequence = null) {
    try {
      return await AuditLog.verifyChainIntegrity(startSequence, endSequence);
    } catch (error) {
      console.error('Error verifying audit log integrity:', error);
      throw error;
    }
  }
  
  /**
   * Export audit logs in various formats
   * @param {Object} filter - Query filter
   * @param {string} format - Export format (json, csv)
   * @returns {Promise<Object>} Export data
   */
  async exportAuditLogs(filter = {}, format = 'json') {
    try {
      const result = await this.getAuditLogs(filter, { limit: 10000 }); // Large limit for export
      const auditLogs = result.auditLogs;
      
      if (format === 'csv') {
        return this.convertToCSV(auditLogs);
      }
      
      return {
        exportedAt: new Date().toISOString(),
        recordCount: auditLogs.length,
        filter,
        auditLogs: auditLogs.map(log => ({
          auditId: log.auditId,
          timestamp: log.timestamp,
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
          } : null,
          action: log.action,
          details: log.details,
          success: log.success,
          ipAddress: log.ipAddress,
          userAgent: log.userAgent,
          sequenceNumber: log.sequenceNumber,
          currentHash: log.currentHash
        }))
      };
    } catch (error) {
      console.error('Error exporting audit logs:', error);
      throw error;
    }
  }
  
  /**
   * Convert audit logs to CSV format
   * @param {Array} auditLogs - Audit log entries
   * @returns {string} CSV formatted data
   */
  convertToCSV(auditLogs) {
    const headers = [
      'Audit ID',
      'Timestamp',
      'Sequence Number',
      'Admin User Name',
      'Admin User Email',
      'Target User Name',
      'Target User Email',
      'Action',
      'Success',
      'Details',
      'IP Address',
      'User Agent',
      'Hash'
    ];
    
    const csvRows = [headers.join(',')];
    
    auditLogs.forEach(log => {
      const row = [
        `"${log.auditId}"`,
        `"${log.timestamp.toISOString()}"`,
        log.sequenceNumber,
        `"${log.adminUserId ? log.adminUserId.name : 'Unknown'}"`,
        `"${log.adminUserId ? log.adminUserId.email : 'Unknown'}"`,
        `"${log.targetUserId ? log.targetUserId.name : 'N/A'}"`,
        `"${log.targetUserId ? log.targetUserId.email : 'N/A'}"`,
        `"${log.action}"`,
        log.success,
        `"${JSON.stringify(log.details).replace(/"/g, '""')}"`,
        `"${log.ipAddress}"`,
        `"${log.userAgent.replace(/"/g, '""')}"`,
        `"${log.currentHash}"`
      ];
      csvRows.push(row.join(','));
    });
    
    return csvRows.join('\n');
  }
  
  /**
   * Get audit statistics
   * @param {number} days - Number of days to look back
   * @returns {Promise<Object>} Audit statistics
   */
  async getAuditStatistics(days = 30) {
    try {
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - days);
      
      // Get action distribution
      const actionStats = await AuditLog.aggregate([
        {
          $match: {
            timestamp: { $gte: startDate }
          }
        },
        {
          $group: {
            _id: '$action',
            count: { $sum: 1 }
          }
        },
        {
          $sort: { count: -1 }
        }
      ]);
      
      // Get daily activity
      const dailyActivity = await AuditLog.aggregate([
        {
          $match: {
            timestamp: { $gte: startDate }
          }
        },
        {
          $group: {
            _id: {
              $dateToString: {
                format: '%Y-%m-%d',
                date: '$timestamp'
              }
            },
            count: { $sum: 1 },
            successCount: {
              $sum: { $cond: ['$success', 1, 0] }
            },
            failureCount: {
              $sum: { $cond: ['$success', 0, 1] }
            }
          }
        },
        {
          $sort: { '_id': 1 }
        }
      ]);
      
      // Get top admin users
      const topAdmins = await AuditLog.aggregate([
        {
          $match: {
            timestamp: { $gte: startDate }
          }
        },
        {
          $group: {
            _id: '$adminUserId',
            count: { $sum: 1 }
          }
        },
        {
          $sort: { count: -1 }
        },
        {
          $limit: 10
        },
        {
          $lookup: {
            from: 'users',
            localField: '_id',
            foreignField: '_id',
            as: 'adminUser'
          }
        },
        {
          $unwind: '$adminUser'
        },
        {
          $project: {
            count: 1,
            adminUser: {
              name: '$adminUser.name',
              email: '$adminUser.email',
              role: '$adminUser.role'
            }
          }
        }
      ]);
      
      const totalEntries = await AuditLog.countDocuments({
        timestamp: { $gte: startDate }
      });
      
      return {
        totalEntries,
        actionDistribution: actionStats,
        dailyActivity,
        topAdmins,
        timeframe: `${days} days`
      };
    } catch (error) {
      console.error('Error getting audit statistics:', error);
      throw error;
    }
  }
  
  /**
   * Run periodic integrity verification job
   * @returns {Promise<Object>} Verification results
   */
  async runIntegrityVerification() {
    try {
      console.log('Starting audit log integrity verification...');
      
      const verificationResult = await this.verifyIntegrity();
      
      // Log the verification results
      const logEntry = {
        adminUserId: 'system', // System-generated entry
        action: 'INTEGRITY_VERIFICATION',
        details: {
          verificationResult,
          timestamp: new Date().toISOString()
        },
        ipAddress: '127.0.0.1',
        userAgent: 'System/IntegrityVerification',
        success: verificationResult.integrityScore === 100,
        metadata: {
          automated: true,
          jobType: 'integrity_verification'
        }
      };
      
      // Don't use createAuditEntry to avoid recursion
      const auditEntry = new AuditLog({
        auditId: `integrity_check_${Date.now()}`,
        timestamp: new Date(),
        adminUserId: null, // System entry
        action: 'INTEGRITY_VERIFICATION',
        details: logEntry.details,
        ipAddress: logEntry.ipAddress,
        userAgent: logEntry.userAgent,
        success: logEntry.success,
        metadata: logEntry.metadata
      });
      
      await auditEntry.save();
      
      console.log('Audit log integrity verification completed:', verificationResult);
      
      return verificationResult;
    } catch (error) {
      console.error('Error running integrity verification:', error);
      throw error;
    }
  }
}

module.exports = new AuditService();