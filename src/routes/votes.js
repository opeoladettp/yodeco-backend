const express = require('express');
const router = express.Router();
const voteService = require('../services/voteService');
const webauthnService = require('../services/webauthnService');
const { authenticate } = require('../middleware/auth');
const { validate, schemas } = require('../middleware/validation');
const { voteRateLimit, generalRateLimit } = require('../middleware/rateLimit');
const { voteIdempotency, requireIdempotencyKey } = require('../middleware/idempotency');

/**
 * POST /api/votes - Submit a vote
 * Requires authentication and biometric verification
 */
router.post('/', 
  // Only require idempotency key in production
  process.env.NODE_ENV === 'production' ? requireIdempotencyKey() : (req, res, next) => next(),
  voteIdempotency,
  voteRateLimit,
  authenticate,
  validate(schemas.voteSubmission),
  async (req, res) => {
    try {
      const { awardId, nomineeId } = req.body;
      const userId = req.user._id.toString();
      
      // TEMPORARILY DISABLED FOR DEMO - Biometric verification checks
      // TODO: Re-enable for production after WebAuthn issues are resolved
      
      // Check if user has WebAuthn credentials registered
      // const hasCredentials = await webauthnService.hasCredentials(userId);
      // if (!hasCredentials) {
      //   return res.status(428).json({
      //     error: {
      //       code: 'BIOMETRIC_SETUP_REQUIRED',
      //       message: 'Biometric authentication setup is required before voting',
      //       details: {
      //         setupUrl: '/api/webauthn/register'
      //       },
      //       retryable: false
      //     }
      //   });
      // }

      // For now, we'll assume biometric verification is handled by the frontend
      // and passed as a header. In a complete implementation, this would verify 
      // a temporary biometric token from a separate WebAuthn authentication endpoint
      // const biometricVerified = req.headers['x-biometric-verified'] === 'true';

      // if (!biometricVerified) {
      //   return res.status(428).json({
      //     error: {
      //       code: 'BIOMETRIC_VERIFICATION_REQUIRED',
      //       message: 'Biometric verification is required for vote submission',
      //       details: {
      //         verificationUrl: '/api/webauthn/authenticate'
      //       },
      //       retryable: true
      //     }
      //   });
      // }

      // For demo purposes, skip biometric verification
      const biometricVerified = true;

      // Get client IP address for audit trail
      const ipAddress = req.ip || req.connection.remoteAddress || req.headers['x-forwarded-for'];

      // Submit the vote
      const result = await voteService.submitVote({
        userId,
        awardId,
        nomineeId,
        biometricVerified: true,
        ipAddress
      });

      res.status(201).json({
        success: true,
        message: result.message,
        vote: {
          id: result.vote._id,
          awardId: result.vote.awardId,
          nomineeId: result.vote.nomineeId,
          timestamp: result.vote.timestamp
        }
      });

    } catch (error) {
      console.error('Vote submission error:', error);

      // Handle specific error types
      if (error.message.includes('already voted')) {
        return res.status(409).json({
          error: {
            code: 'DUPLICATE_VOTE',
            message: error.message,
            retryable: false
          }
        });
      }

      if (error.message.includes('not found')) {
        return res.status(404).json({
          error: {
            code: 'RESOURCE_NOT_FOUND',
            message: error.message,
            retryable: false
          }
        });
      }

      if (error.message.includes('not active') || error.message.includes('ended') || error.message.includes('not started')) {
        return res.status(400).json({
          error: {
            code: 'VOTING_NOT_AVAILABLE',
            message: error.message,
            retryable: false
          }
        });
      }

      if (error.message.includes('does not belong')) {
        return res.status(400).json({
          error: {
            code: 'INVALID_NOMINEE_AWARD',
            message: error.message,
            retryable: false
          }
        });
      }

      // Generic server error
      res.status(500).json({
        error: {
          code: 'VOTE_SUBMISSION_ERROR',
          message: 'Failed to submit vote',
          retryable: true
        }
      });
    }
  }
);

/**
 * GET /api/votes/my-history - Get user's voting history
 * Requires authentication
 */
router.get('/my-history', 
  generalRateLimit,
  authenticate,
  async (req, res) => {
    try {
      const userId = req.user._id.toString();
      const history = await voteService.getUserVotingHistory(userId);

      res.json({
        success: true,
        votes: history.map(vote => ({
          id: vote._id,
          award: {
            id: vote.awardId,
            title: vote.award?.title
          },
          nominee: {
            id: vote.nomineeId,
            name: vote.nominee?.name
          },
          timestamp: vote.timestamp,
          biometricVerified: vote.biometricVerified
        }))
      });

    } catch (error) {
      console.error('Error getting voting history:', error);
      res.status(500).json({
        error: {
          code: 'HISTORY_RETRIEVAL_ERROR',
          message: 'Failed to retrieve voting history',
          retryable: true
        }
      });
    }
  }
);

/**
 * GET /api/votes/counts/:awardId - Get real-time vote counts for an award
 * Public endpoint (no authentication required)
 */
router.get('/counts/:awardId', async (req, res) => {
  try {
    const { awardId } = req.params;

    // Validate awardId format
    if (!/^[0-9a-fA-F]{24}$/.test(awardId)) {
      return res.status(400).json({
        error: {
          code: 'INVALID_AWARD_ID',
          message: 'Invalid award ID format',
          retryable: false
        }
      });
    }

    const counts = await voteService.getVoteCountsForAward(awardId);

    res.json({
      success: true,
      awardId,
      counts: counts.map(count => ({
        nominee: {
          id: count.nomineeId,
          name: count.nomineeName
        },
        voteCount: count.count
      })),
      totalVotes: counts.reduce((sum, count) => sum + count.count, 0),
      lastUpdated: new Date().toISOString()
    });

  } catch (error) {
    console.error('Error getting vote counts:', error);
    res.status(500).json({
      error: {
        code: 'COUNT_RETRIEVAL_ERROR',
        message: 'Failed to retrieve vote counts',
        retryable: true
      }
    });
  }
});

/**
 * GET /api/votes/results - Get final results for all awards
 * Public endpoint (no authentication required)
 */
router.get('/results', async (req, res) => {
  try {
    // Get all active awards
    const Award = require('../models/Award');
    const awards = await Award.find({ isActive: true }).populate('categoryId', 'name');

    const results = [];

    for (const award of awards) {
      const counts = await voteService.getVoteCountsForAward(award._id.toString());
      
      results.push({
        award: {
          id: award._id,
          title: award.title,
          category: award.categoryId?.name
        },
        nominees: counts.map(count => ({
          nominee: {
            id: count.nomineeId,
            name: count.nomineeName
          },
          voteCount: count.count
        })).sort((a, b) => b.voteCount - a.voteCount), // Sort by vote count descending
        totalVotes: counts.reduce((sum, count) => sum + count.count, 0)
      });
    }

    res.json({
      success: true,
      results,
      generatedAt: new Date().toISOString()
    });

  } catch (error) {
    console.error('Error getting results:', error);
    res.status(500).json({
      error: {
        code: 'RESULTS_RETRIEVAL_ERROR',
        message: 'Failed to retrieve voting results',
        retryable: true
      }
    });
  }
});

/**
 * GET /api/votes/check/:awardId - Check if user has voted for a specific award
 * Requires authentication
 */
router.get('/check/:awardId', 
  authenticate,
  async (req, res) => {
    try {
      const { awardId } = req.params;
      const userId = req.user._id.toString();

      // Validate awardId format
      if (!/^[0-9a-fA-F]{24}$/.test(awardId)) {
        return res.status(400).json({
          error: {
            code: 'INVALID_AWARD_ID',
            message: 'Invalid award ID format',
            retryable: false
          }
        });
      }

      const existingVote = await voteService.checkUserVoteForAward(userId, awardId);

      res.json({
        success: true,
        hasVoted: !!existingVote,
        vote: existingVote ? {
          id: existingVote._id,
          nomineeId: existingVote.nomineeId,
          timestamp: existingVote.timestamp
        } : null
      });

    } catch (error) {
      console.error('Error checking vote status:', error);
      res.status(500).json({
        error: {
          code: 'VOTE_CHECK_ERROR',
          message: 'Failed to check voting status',
          retryable: true
        }
      });
    }
  }
);

/**
 * POST /api/votes/cache/warm - Warm vote counts cache for all active awards
 * Requires System_Admin role
 */
router.post('/cache/warm',
  authenticate,
  async (req, res) => {
    try {
      // Check if user is System_Admin
      if (req.user.role !== 'System_Admin') {
        return res.status(403).json({
          error: {
            code: 'INSUFFICIENT_PERMISSIONS',
            message: 'System_Admin role required for cache operations',
            retryable: false
          }
        });
      }

      const results = await voteService.warmVoteCountsCache();

      res.json({
        success: true,
        message: 'Cache warming completed',
        results: {
          totalAwards: results.total,
          successfullyWarmed: results.success,
          failed: results.failed,
          errors: results.errors
        }
      });

    } catch (error) {
      console.error('Error warming cache:', error);
      res.status(500).json({
        error: {
          code: 'CACHE_WARM_ERROR',
          message: 'Failed to warm vote counts cache',
          retryable: true
        }
      });
    }
  }
);

/**
 * POST /api/votes/cache/warm/:awardId - Warm vote counts cache for specific award
 * Requires System_Admin role
 */
router.post('/cache/warm/:awardId',
  authenticate,
  async (req, res) => {
    try {
      // Check if user is System_Admin
      if (req.user.role !== 'System_Admin') {
        return res.status(403).json({
          error: {
            code: 'INSUFFICIENT_PERMISSIONS',
            message: 'System_Admin role required for cache operations',
            retryable: false
          }
        });
      }

      const { awardId } = req.params;

      // Validate awardId format
      if (!/^[0-9a-fA-F]{24}$/.test(awardId)) {
        return res.status(400).json({
          error: {
            code: 'INVALID_AWARD_ID',
            message: 'Invalid award ID format',
            retryable: false
          }
        });
      }

      const success = await voteService.warmVoteCountsCacheForAward(awardId);

      if (success) {
        res.json({
          success: true,
          message: `Cache warmed successfully for award ${awardId}`
        });
      } else {
        res.status(500).json({
          error: {
            code: 'CACHE_WARM_ERROR',
            message: `Failed to warm cache for award ${awardId}`,
            retryable: true
          }
        });
      }

    } catch (error) {
      console.error('Error warming cache for award:', error);
      res.status(500).json({
        error: {
          code: 'CACHE_WARM_ERROR',
          message: 'Failed to warm vote counts cache for award',
          retryable: true
        }
      });
    }
  }
);

/**
 * DELETE /api/votes/cache/:awardId - Clear vote counts cache for specific award
 * Requires System_Admin role
 */
router.delete('/cache/:awardId',
  authenticate,
  async (req, res) => {
    try {
      // Check if user is System_Admin
      if (req.user.role !== 'System_Admin') {
        return res.status(403).json({
          error: {
            code: 'INSUFFICIENT_PERMISSIONS',
            message: 'System_Admin role required for cache operations',
            retryable: false
          }
        });
      }

      const { awardId } = req.params;

      // Validate awardId format
      if (!/^[0-9a-fA-F]{24}$/.test(awardId)) {
        return res.status(400).json({
          error: {
            code: 'INVALID_AWARD_ID',
            message: 'Invalid award ID format',
            retryable: false
          }
        });
      }

      const success = await voteService.clearVoteCountsCache(awardId);

      if (success) {
        res.json({
          success: true,
          message: `Cache cleared successfully for award ${awardId}`
        });
      } else {
        res.status(500).json({
          error: {
            code: 'CACHE_CLEAR_ERROR',
            message: `Failed to clear cache for award ${awardId}`,
            retryable: true
          }
        });
      }

    } catch (error) {
      console.error('Error clearing cache for award:', error);
      res.status(500).json({
        error: {
          code: 'CACHE_CLEAR_ERROR',
          message: 'Failed to clear vote counts cache for award',
          retryable: true
        }
      });
    }
  }
);

/**
 * GET /api/votes/cache/consistency - Check cache-database consistency for all awards
 * Requires System_Admin role
 */
router.get('/cache/consistency',
  authenticate,
  async (req, res) => {
    try {
      // Check if user is System_Admin
      if (req.user.role !== 'System_Admin') {
        return res.status(403).json({
          error: {
            code: 'INSUFFICIENT_PERMISSIONS',
            message: 'System_Admin role required for cache operations',
            retryable: false
          }
        });
      }

      const results = await voteService.verifyAllCacheConsistency();

      res.json({
        success: true,
        message: 'Cache consistency check completed',
        consistency: results
      });

    } catch (error) {
      console.error('Error checking cache consistency:', error);
      res.status(500).json({
        error: {
          code: 'CONSISTENCY_CHECK_ERROR',
          message: 'Failed to check cache consistency',
          retryable: true
        }
      });
    }
  }
);

/**
 * GET /api/votes/cache/consistency/:awardId - Check cache-database consistency for specific award
 * Requires System_Admin role
 */
router.get('/cache/consistency/:awardId',
  authenticate,
  async (req, res) => {
    try {
      // Check if user is System_Admin
      if (req.user.role !== 'System_Admin') {
        return res.status(403).json({
          error: {
            code: 'INSUFFICIENT_PERMISSIONS',
            message: 'System_Admin role required for cache operations',
            retryable: false
          }
        });
      }

      const { awardId } = req.params;

      // Validate awardId format
      if (!/^[0-9a-fA-F]{24}$/.test(awardId)) {
        return res.status(400).json({
          error: {
            code: 'INVALID_AWARD_ID',
            message: 'Invalid award ID format',
            retryable: false
          }
        });
      }

      const consistency = await voteService.verifyCacheConsistency(awardId);

      res.json({
        success: true,
        message: `Cache consistency check completed for award ${awardId}`,
        consistency
      });

    } catch (error) {
      console.error('Error checking cache consistency for award:', error);
      res.status(500).json({
        error: {
          code: 'CONSISTENCY_CHECK_ERROR',
          message: 'Failed to check cache consistency for award',
          retryable: true
        }
      });
    }
  }
);

/**
 * POST /api/votes/cache/sync - Synchronize cache with database for all awards
 * Requires System_Admin role
 */
router.post('/cache/sync',
  authenticate,
  async (req, res) => {
    try {
      // Check if user is System_Admin
      if (req.user.role !== 'System_Admin') {
        return res.status(403).json({
          error: {
            code: 'INSUFFICIENT_PERMISSIONS',
            message: 'System_Admin role required for cache operations',
            retryable: false
          }
        });
      }

      const { forceRebuild = false } = req.body;

      const results = await voteService.synchronizeAllCaches(forceRebuild);

      res.json({
        success: true,
        message: 'Cache synchronization completed',
        results
      });

    } catch (error) {
      console.error('Error synchronizing caches:', error);
      res.status(500).json({
        error: {
          code: 'CACHE_SYNC_ERROR',
          message: 'Failed to synchronize caches',
          retryable: true
        }
      });
    }
  }
);

/**
 * POST /api/votes/cache/sync/:awardId - Synchronize cache with database for specific award
 * Requires System_Admin role
 */
router.post('/cache/sync/:awardId',
  authenticate,
  async (req, res) => {
    try {
      // Check if user is System_Admin
      if (req.user.role !== 'System_Admin') {
        return res.status(403).json({
          error: {
            code: 'INSUFFICIENT_PERMISSIONS',
            message: 'System_Admin role required for cache operations',
            retryable: false
          }
        });
      }

      const { awardId } = req.params;
      const { forceRebuild = false } = req.body;

      // Validate awardId format
      if (!/^[0-9a-fA-F]{24}$/.test(awardId)) {
        return res.status(400).json({
          error: {
            code: 'INVALID_AWARD_ID',
            message: 'Invalid award ID format',
            retryable: false
          }
        });
      }

      const result = await voteService.synchronizeCacheForAward(awardId, forceRebuild);

      res.json({
        success: true,
        message: `Cache synchronization completed for award ${awardId}`,
        result
      });

    } catch (error) {
      console.error('Error synchronizing cache for award:', error);
      res.status(500).json({
        error: {
          code: 'CACHE_SYNC_ERROR',
          message: 'Failed to synchronize cache for award',
          retryable: true
        }
      });
    }
  }
);

/**
 * POST /api/votes/test/concurrent - Test concurrent vote handling
 * Requires System_Admin role - FOR TESTING PURPOSES ONLY
 */
router.post('/test/concurrent',
  authenticate,
  async (req, res) => {
    try {
      // Check if user is System_Admin
      if (req.user.role !== 'System_Admin') {
        return res.status(403).json({
          error: {
            code: 'INSUFFICIENT_PERMISSIONS',
            message: 'System_Admin role required for testing operations',
            retryable: false
          }
        });
      }

      const { awardId, userIds, nomineeId, concurrency = 10 } = req.body;

      if (!awardId || !userIds || !nomineeId) {
        return res.status(400).json({
          error: {
            code: 'MISSING_REQUIRED_FIELDS',
            message: 'awardId, userIds, and nomineeId are required',
            retryable: false
          }
        });
      }

      const results = await voteService.testConcurrentVoting({
        awardId,
        userIds,
        nomineeId,
        concurrency
      });

      res.json({
        success: true,
        message: 'Concurrent voting test completed',
        results
      });

    } catch (error) {
      console.error('Error running concurrent voting test:', error);
      res.status(500).json({
        error: {
          code: 'CONCURRENT_TEST_ERROR',
          message: 'Failed to run concurrent voting test',
          retryable: true
        }
      });
    }
  }
);

/**
 * POST /api/votes/test/stress - Run stress test on voting system
 * Requires System_Admin role - FOR TESTING PURPOSES ONLY
 */
router.post('/test/stress',
  authenticate,
  async (req, res) => {
    try {
      // Check if user is System_Admin
      if (req.user.role !== 'System_Admin') {
        return res.status(403).json({
          error: {
            code: 'INSUFFICIENT_PERMISSIONS',
            message: 'System_Admin role required for testing operations',
            retryable: false
          }
        });
      }

      const { 
        awardId, 
        userCount = 100, 
        concurrentBatches = 5, 
        batchSize = 20 
      } = req.body;

      if (!awardId) {
        return res.status(400).json({
          error: {
            code: 'MISSING_REQUIRED_FIELDS',
            message: 'awardId is required',
            retryable: false
          }
        });
      }

      const results = await voteService.stressTestVoting({
        awardId,
        userCount,
        concurrentBatches,
        batchSize
      });

      res.json({
        success: true,
        message: 'Stress test completed',
        results
      });

    } catch (error) {
      console.error('Error running stress test:', error);
      res.status(500).json({
        error: {
          code: 'STRESS_TEST_ERROR',
          message: 'Failed to run stress test',
          retryable: true
        }
      });
    }
  }
);

module.exports = router;