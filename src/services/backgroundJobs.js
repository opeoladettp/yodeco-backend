const auditService = require('./auditService');
const redisService = require('./redisService');

class BackgroundJobService {
  constructor() {
    this.jobs = new Map();
    this.isRunning = false;
  }
  
  /**
   * Start the background job scheduler
   */
  start() {
    if (this.isRunning) {
      console.log('Background job service is already running');
      return;
    }
    
    this.isRunning = true;
    console.log('Starting background job service...');
    
    // Schedule integrity verification job to run every 6 hours
    this.scheduleJob('integrity-verification', 6 * 60 * 60 * 1000, async () => {
      await this.runIntegrityVerificationJob();
    });
    
    // Schedule audit log cleanup job to run daily
    this.scheduleJob('audit-cleanup', 24 * 60 * 60 * 1000, async () => {
      await this.runAuditCleanupJob();
    });
    
    // Schedule cache synchronization job to run every hour
    this.scheduleJob('cache-sync', 60 * 60 * 1000, async () => {
      await this.runCacheSyncJob();
    });
    
    console.log('Background job service started successfully');
  }
  
  /**
   * Stop the background job scheduler
   */
  stop() {
    if (!this.isRunning) {
      console.log('Background job service is not running');
      return;
    }
    
    console.log('Stopping background job service...');
    
    // Clear all scheduled jobs
    this.jobs.forEach((intervalId, jobName) => {
      clearInterval(intervalId);
      console.log(`Stopped job: ${jobName}`);
    });
    
    this.jobs.clear();
    this.isRunning = false;
    
    console.log('Background job service stopped');
  }
  
  /**
   * Schedule a recurring job
   * @param {string} jobName - Name of the job
   * @param {number} intervalMs - Interval in milliseconds
   * @param {Function} jobFunction - Function to execute
   */
  scheduleJob(jobName, intervalMs, jobFunction) {
    if (this.jobs.has(jobName)) {
      console.log(`Job ${jobName} is already scheduled`);
      return;
    }
    
    const intervalId = setInterval(async () => {
      try {
        console.log(`Running background job: ${jobName}`);
        await jobFunction();
        console.log(`Completed background job: ${jobName}`);
      } catch (error) {
        console.error(`Error in background job ${jobName}:`, error);
      }
    }, intervalMs);
    
    this.jobs.set(jobName, intervalId);
    console.log(`Scheduled job: ${jobName} (interval: ${intervalMs}ms)`);
  }
  
  /**
   * Run integrity verification job
   */
  async runIntegrityVerificationJob() {
    try {
      console.log('Starting periodic audit log integrity verification...');
      
      const verificationResult = await auditService.runIntegrityVerification();
      
      // Store verification result in Redis for monitoring
      const redis = redisService.getClient();
      const resultKey = `integrity_check:${Date.now()}`;
      await redis.setEx(resultKey, 86400 * 7, JSON.stringify({
        timestamp: new Date().toISOString(),
        result: verificationResult,
        jobType: 'periodic'
      })); // 7 day TTL
      
      // Keep only the last 10 verification results
      const keys = await redis.keys('integrity_check:*');
      if (keys.length > 10) {
        const sortedKeys = keys.sort();
        const keysToDelete = sortedKeys.slice(0, keys.length - 10);
        if (keysToDelete.length > 0) {
          await redis.del(...keysToDelete);
        }
      }
      
      // Alert if integrity issues found
      if (verificationResult.integrityScore < 100) {
        console.warn('Audit log integrity issues detected:', verificationResult);
        
        // In a production system, you would send alerts here
        // For now, we'll just log the issue
        await this.logIntegrityAlert(verificationResult);
      }
      
      console.log('Periodic integrity verification completed successfully');
    } catch (error) {
      console.error('Error in integrity verification job:', error);
    }
  }
  
  /**
   * Run audit log cleanup job
   */
  async runAuditCleanupJob() {
    try {
      console.log('Starting audit log cleanup job...');
      
      const redis = redisService.getClient();
      
      // Clean up old Redis audit logs (older than 2 years)
      const cutoffDate = new Date();
      cutoffDate.setFullYear(cutoffDate.getFullYear() - 2);
      
      const auditKeys = await redis.keys('audit_log:*');
      let deletedCount = 0;
      
      for (const key of auditKeys) {
        const logData = await redis.get(key);
        if (logData) {
          const log = JSON.parse(logData);
          if (new Date(log.timestamp) < cutoffDate) {
            await redis.del(key);
            deletedCount++;
          }
        }
      }
      
      // Clean up old activity tracking data (older than 90 days)
      const activityCutoff = new Date();
      activityCutoff.setDate(activityCutoff.getDate() - 90);
      
      const activityKeys = await redis.keys('user_activity:*');
      let activityDeletedCount = 0;
      
      for (const key of activityKeys) {
        const activityData = await redis.get(key);
        if (activityData) {
          const activity = JSON.parse(activityData);
          if (new Date(activity.timestamp) < activityCutoff) {
            await redis.del(key);
            activityDeletedCount++;
          }
        }
      }
      
      console.log(`Audit cleanup completed: ${deletedCount} audit logs deleted, ${activityDeletedCount} activity records deleted`);
    } catch (error) {
      console.error('Error in audit cleanup job:', error);
    }
  }
  
  /**
   * Run cache synchronization job
   */
  async runCacheSyncJob() {
    try {
      console.log('Starting cache synchronization job...');
      
      // This job would synchronize Redis cache with MongoDB
      // For now, we'll just verify that critical caches are healthy
      
      const redis = redisService.getClient();
      
      // Check Redis connectivity
      const pingResult = await redis.ping();
      if (pingResult !== 'PONG') {
        throw new Error('Redis connectivity check failed');
      }
      
      // Check cache sizes and report metrics
      const auditCacheKeys = await redis.keys('audit_cache:*');
      const activityKeys = await redis.keys('user_activity:*');
      const tokenKeys = await redis.keys('blacklist:*');
      
      const cacheMetrics = {
        auditCacheEntries: auditCacheKeys.length,
        activityEntries: activityKeys.length,
        blacklistedTokens: tokenKeys.length,
        timestamp: new Date().toISOString()
      };
      
      // Store cache metrics
      await redis.setEx('cache_metrics:latest', 3600, JSON.stringify(cacheMetrics)); // 1 hour TTL
      
      console.log('Cache synchronization completed:', cacheMetrics);
    } catch (error) {
      console.error('Error in cache synchronization job:', error);
    }
  }
  
  /**
   * Log integrity alert
   * @param {Object} verificationResult - Integrity verification result
   */
  async logIntegrityAlert(verificationResult) {
    try {
      const redis = redisService.getClient();
      
      const alert = {
        timestamp: new Date().toISOString(),
        type: 'INTEGRITY_ALERT',
        severity: verificationResult.integrityScore < 50 ? 'CRITICAL' : 'WARNING',
        details: verificationResult,
        message: `Audit log integrity score: ${verificationResult.integrityScore}%`
      };
      
      const alertKey = `integrity_alert:${Date.now()}`;
      await redis.setEx(alertKey, 86400 * 30, JSON.stringify(alert)); // 30 day TTL
      
      console.warn('Integrity alert logged:', alert);
    } catch (error) {
      console.error('Error logging integrity alert:', error);
    }
  }
  
  /**
   * Get job status
   * @returns {Object} Job status information
   */
  getStatus() {
    return {
      isRunning: this.isRunning,
      activeJobs: Array.from(this.jobs.keys()),
      jobCount: this.jobs.size
    };
  }
  
  /**
   * Get recent integrity check results
   * @returns {Promise<Array>} Recent integrity check results
   */
  async getRecentIntegrityChecks() {
    try {
      const redis = redisService.getClient();
      const keys = await redis.keys('integrity_check:*');
      
      const results = [];
      for (const key of keys.sort().slice(-10)) { // Get last 10 results
        const data = await redis.get(key);
        if (data) {
          results.push(JSON.parse(data));
        }
      }
      
      return results.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
    } catch (error) {
      console.error('Error getting recent integrity checks:', error);
      return [];
    }
  }
}

module.exports = new BackgroundJobService();