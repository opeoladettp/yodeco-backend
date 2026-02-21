const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const { requireRole } = require('../middleware/rbac');
const { 
  getBlockedIPs, 
  unblockIP, 
  getRateLimitStats,
  clearRateLimit 
} = require('../middleware/rateLimit');

/**
 * @route   GET /api/rate-limit/blocked-ips
 * @desc    Get all blocked IPs (System Admin only)
 * @access  Private (System Admin)
 */
router.get('/blocked-ips', authenticate, requireRole('System_Admin'), async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 100;
    const blockedIPs = await getBlockedIPs(limit);
    
    res.json({
      success: true,
      data: {
        blockedIPs,
        total: blockedIPs.length,
        timestamp: new Date().toISOString()
      }
    });
  } catch (error) {
    console.error('Error fetching blocked IPs:', error);
    res.status(500).json({
      error: {
        code: 'FETCH_BLOCKED_IPS_ERROR',
        message: 'Failed to fetch blocked IPs',
        details: error.message
      }
    });
  }
});

/**
 * @route   POST /api/rate-limit/unblock/:ip
 * @desc    Unblock a specific IP address (System Admin only)
 * @access  Private (System Admin)
 */
router.post('/unblock/:ip', authenticate, requireRole('System_Admin'), async (req, res) => {
  try {
    const { ip } = req.params;
    
    if (!ip) {
      return res.status(400).json({
        error: {
          code: 'MISSING_IP',
          message: 'IP address is required'
        }
      });
    }
    
    const result = await unblockIP(ip);
    
    if (result.success) {
      res.json({
        success: true,
        data: result,
        message: `Successfully unblocked IP: ${ip}`
      });
    } else {
      res.status(500).json({
        error: {
          code: 'UNBLOCK_IP_ERROR',
          message: 'Failed to unblock IP',
          details: result.error
        }
      });
    }
  } catch (error) {
    console.error('Error unblocking IP:', error);
    res.status(500).json({
      error: {
        code: 'UNBLOCK_IP_ERROR',
        message: 'Failed to unblock IP',
        details: error.message
      }
    });
  }
});

/**
 * @route   POST /api/rate-limit/unblock-multiple
 * @desc    Unblock multiple IP addresses (System Admin only)
 * @access  Private (System Admin)
 */
router.post('/unblock-multiple', authenticate, requireRole('System_Admin'), async (req, res) => {
  try {
    const { ips } = req.body;
    
    if (!ips || !Array.isArray(ips) || ips.length === 0) {
      return res.status(400).json({
        error: {
          code: 'INVALID_IPS',
          message: 'Array of IP addresses is required'
        }
      });
    }
    
    const results = [];
    for (const ip of ips) {
      const result = await unblockIP(ip);
      results.push(result);
    }
    
    const successCount = results.filter(r => r.success).length;
    const failCount = results.length - successCount;
    
    res.json({
      success: true,
      data: {
        results,
        summary: {
          total: results.length,
          successful: successCount,
          failed: failCount
        }
      },
      message: `Unblocked ${successCount} of ${results.length} IPs`
    });
  } catch (error) {
    console.error('Error unblocking multiple IPs:', error);
    res.status(500).json({
      error: {
        code: 'UNBLOCK_MULTIPLE_ERROR',
        message: 'Failed to unblock IPs',
        details: error.message
      }
    });
  }
});

/**
 * @route   GET /api/rate-limit/stats
 * @desc    Get rate limit statistics (System Admin only)
 * @access  Private (System Admin)
 */
router.get('/stats', authenticate, requireRole('System_Admin'), async (req, res) => {
  try {
    const stats = await getRateLimitStats();
    
    res.json({
      success: true,
      data: {
        stats,
        timestamp: new Date().toISOString()
      }
    });
  } catch (error) {
    console.error('Error fetching rate limit stats:', error);
    res.status(500).json({
      error: {
        code: 'FETCH_STATS_ERROR',
        message: 'Failed to fetch rate limit statistics',
        details: error.message
      }
    });
  }
});

/**
 * @route   DELETE /api/rate-limit/clear-all
 * @desc    Clear all rate limits (System Admin only - use with caution)
 * @access  Private (System Admin)
 */
router.delete('/clear-all', authenticate, requireRole('System_Admin'), async (req, res) => {
  try {
    const redisService = require('../services/redisService');
    const client = redisService.getClient();
    
    // Get all rate limit keys
    const rateLimitKeys = await client.keys('rate_limit:*');
    const blockedIPKeys = await client.keys('blocked_ips:*');
    
    let clearedCount = 0;
    
    // Clear rate limit keys
    for (const key of rateLimitKeys) {
      await client.del(key);
      clearedCount++;
    }
    
    // Clear blocked IP keys
    for (const key of blockedIPKeys) {
      await client.del(key);
      clearedCount++;
    }
    
    res.json({
      success: true,
      data: {
        clearedKeys: clearedCount,
        rateLimitKeys: rateLimitKeys.length,
        blockedIPKeys: blockedIPKeys.length
      },
      message: `Cleared all rate limits (${clearedCount} keys)`
    });
  } catch (error) {
    console.error('Error clearing all rate limits:', error);
    res.status(500).json({
      error: {
        code: 'CLEAR_ALL_ERROR',
        message: 'Failed to clear all rate limits',
        details: error.message
      }
    });
  }
});

module.exports = router;
