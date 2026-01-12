const Vote = require('../models/Vote');
const Award = require('../models/Award');
const Nominee = require('../models/Nominee');
const VoteBias = require('../models/VoteBias');
const redisService = require('./redisService');
const { withDatabaseCircuitBreaker } = require('../utils/circuitBreaker');
const crypto = require('crypto');

class VoteService {
  /**
   * Submit a vote with duplicate prevention and validation
   * @param {Object} voteData - Vote submission data
   * @param {string} voteData.userId - User ID casting the vote
   * @param {string} voteData.awardId - Award ID being voted for
   * @param {string} voteData.nomineeId - Nominee ID being voted for
   * @param {boolean} voteData.biometricVerified - Whether biometric verification passed
   * @param {string} voteData.ipAddress - Raw IP address (will be hashed)
   * @param {number} maxRetries - Maximum retry attempts for database operations
   * @returns {Promise<Object>} Vote submission result
   */
  async submitVote(voteData, maxRetries = 3) {
    const { userId, awardId, nomineeId, biometricVerified, ipAddress } = voteData;

    // Validate required fields first
    if (!userId || !awardId || !nomineeId) {
      const error = new Error('Missing required fields: userId, awardId, and nomineeId are required');
      error.statusCode = 400;
      error.code = 'MISSING_REQUIRED_FIELDS';
      error.retryable = false;
      throw error;
    }

    // TEMPORARILY DISABLED FOR DEMO - Biometric verification requirement
    // TODO: Re-enable for production after WebAuthn issues are resolved
    
    // Validate biometric verification requirement
    // if (!biometricVerified) {
    //   const error = new Error('Biometric verification is required for vote submission');
    //   error.statusCode = 428;
    //   error.code = 'BIOMETRIC_VERIFICATION_REQUIRED';
    //   error.retryable = true;
    //   throw error;
    // }

    // For demo purposes, accept votes without biometric verification

    let lastError = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        // Use circuit breaker for database operations
        const result = await withDatabaseCircuitBreaker(async () => {
          // Check if award exists and is active
          const award = await Award.findById(awardId);
          if (!award) {
            const error = new Error('Award not found');
            error.statusCode = 404;
            error.code = 'AWARD_NOT_FOUND';
            error.retryable = false;
            throw error;
          }

          if (!award.isActive) {
            const error = new Error('Voting is not active for this award');
            error.statusCode = 400;
            error.code = 'VOTING_NOT_ACTIVE';
            error.retryable = false;
            throw error;
          }

          // Check voting period if dates are set
          const now = new Date();
          if (award.votingStartDate && now < award.votingStartDate) {
            const error = new Error('Voting has not started for this award');
            error.statusCode = 400;
            error.code = 'VOTING_NOT_STARTED';
            error.retryable = false;
            error.details = { votingStartDate: award.votingStartDate };
            throw error;
          }

          if (award.votingEndDate && now > award.votingEndDate) {
            const error = new Error('Voting has ended for this award');
            error.statusCode = 400;
            error.code = 'VOTING_ENDED';
            error.retryable = false;
            error.details = { votingEndDate: award.votingEndDate };
            throw error;
          }

          // Check if nominee exists and belongs to the award
          const nominee = await Nominee.findById(nomineeId);
          if (!nominee) {
            const error = new Error('Nominee not found');
            error.statusCode = 404;
            error.code = 'NOMINEE_NOT_FOUND';
            error.retryable = false;
            throw error;
          }

          if (!nominee.awardId.equals(awardId)) {
            const error = new Error('Nominee does not belong to the specified award');
            error.statusCode = 400;
            error.code = 'NOMINEE_AWARD_MISMATCH';
            error.retryable = false;
            throw error;
          }

          // Application-level duplicate vote check with retry logic
          const existingVote = await Vote.hasUserVotedForAward(userId, awardId);
          if (existingVote) {
            const error = new Error('User has already voted for this award');
            error.statusCode = 409;
            error.code = 'DUPLICATE_VOTE';
            error.retryable = false;
            error.details = {
              existingVote: {
                nomineeId: existingVote.nomineeId,
                timestamp: existingVote.timestamp
              }
            };
            throw error;
          }

          // Hash IP address for privacy
          const hashedIpAddress = ipAddress ? 
            crypto.createHash('sha256').update(ipAddress).digest('hex') : null;

          // Create vote record
          const vote = new Vote({
            userId,
            awardId,
            nomineeId,
            biometricVerified,
            ipAddress: hashedIpAddress,
            timestamp: new Date()
          });

          // Save vote (database-level unique constraint will catch any race conditions)
          const savedVote = await vote.save();
          return savedVote;
        }, 
        // Fallback function for database circuit breaker
        async () => {
          const error = new Error('Database service temporarily unavailable');
          error.statusCode = 503;
          error.code = 'DATABASE_UNAVAILABLE';
          error.retryable = true;
          error.retryAfter = 30;
          throw error;
        });

        // Update Redis vote counts asynchronously with retry logic
        this.updateVoteCountsInCache(awardId, nomineeId).catch(error => {
          console.error('Failed to update vote counts in cache:', error);
          // Don't fail the vote submission if cache update fails
        });

        return {
          success: true,
          vote: result,
          message: 'Vote submitted successfully',
          attempt
        };

      } catch (error) {
        lastError = error;

        // Handle MongoDB duplicate key error (race condition detected)
        if (error.code === 11000) {
          // This is a definitive duplicate - don't retry
          const existingVote = await Vote.hasUserVotedForAward(userId, awardId);
          const duplicateError = new Error('Duplicate vote detected: User has already voted for this award');
          duplicateError.statusCode = 409;
          duplicateError.code = 'DUPLICATE_VOTE';
          duplicateError.retryable = false;
          duplicateError.details = existingVote ? {
            existingVote: {
              nomineeId: existingVote.nomineeId,
              timestamp: existingVote.timestamp
            }
          } : null;
          throw duplicateError;
        }

        // Handle validation errors - don't retry
        if (error.name === 'ValidationError' || 
            error.statusCode === 400 ||
            error.statusCode === 404 ||
            error.statusCode === 409 ||
            error.statusCode === 428) {
          throw error;
        }

        // For other errors (network, temporary DB issues), retry with backoff
        console.error(`Vote submission attempt ${attempt}/${maxRetries} failed:`, error);
        
        if (attempt < maxRetries) {
          // Exponential backoff: 200ms, 400ms, 800ms
          const delayMs = 200 * Math.pow(2, attempt - 1);
          await new Promise(resolve => setTimeout(resolve, delayMs));
        }
      }
    }

    // All retries failed
    console.error(`Vote submission failed after ${maxRetries} attempts:`, lastError);
    const finalError = new Error(`Vote submission failed after ${maxRetries} attempts: ${lastError.message}`);
    finalError.statusCode = 503;
    finalError.code = 'VOTE_SUBMISSION_FAILED';
    finalError.retryable = true;
    finalError.retryAfter = 60;
    throw finalError;
  }

  /**
   * Get vote counts for an award with circuit breaker and fallback
   * Includes bias adjustments from admin-applied vote bias
   * @param {string} awardId - Award ID
   * @returns {Promise<Array>} Vote counts by nominee (including bias)
   */
  async getVoteCountsForAward(awardId) {
    try {
      console.log(`Getting vote counts for award: ${awardId}`);
      
      // Try to get from Redis cache first
      const cachedCounts = await this.getVoteCountsFromCache(awardId);
      if (cachedCounts) {
        console.log(`Found cached counts for award ${awardId}:`, cachedCounts);
        return cachedCounts;
      }

      console.log(`No cached counts found, querying database for award ${awardId}`);
      
      // Fallback to database aggregation with circuit breaker
      const counts = await withDatabaseCircuitBreaker(
        async () => {
          // Get regular vote counts
          const voteCounts = await Vote.getVoteCountsForAward(awardId);
          
          // Get bias adjustments
          const biasEntries = await VoteBias.getActiveBiasForAward(awardId);
          
          // Apply bias to vote counts
          const adjustedCounts = this.applyBiasToVoteCounts(voteCounts, biasEntries);
          
          return adjustedCounts;
        },
        // Fallback: return empty array if database is unavailable
        async () => {
          console.warn('Database unavailable for vote counts, returning empty results');
          return [];
        }
      );
      
      console.log(`Database returned counts for award ${awardId}:`, counts);
      
      // Cache the results for future requests
      this.cacheVoteCounts(awardId, counts).catch(error => {
        console.error('Failed to cache vote counts:', error);
      });

      return counts;
    } catch (error) {
      console.error('Error getting vote counts:', error);
      const serviceError = new Error('Failed to retrieve vote counts');
      serviceError.statusCode = 503;
      serviceError.code = 'VOTE_COUNTS_UNAVAILABLE';
      serviceError.retryable = true;
      serviceError.retryAfter = 30;
      throw serviceError;
    }
  }

  /**
   * Apply bias adjustments to vote counts
   * @param {Array} voteCounts - Original vote counts from database
   * @param {Array} biasEntries - Active bias entries for the award
   * @returns {Array} Adjusted vote counts with bias applied
   * @private
   */
  applyBiasToVoteCounts(voteCounts, biasEntries) {
    // Create a map of nominee IDs to vote counts
    const countsMap = new Map();
    
    // Initialize with original vote counts
    voteCounts.forEach(count => {
      countsMap.set(count.nomineeId, {
        nomineeId: count.nomineeId,
        nomineeName: count.nomineeName,
        count: count.count,
        originalCount: count.count,
        biasAmount: 0,
        hasBias: false
      });
    });
    
    // Apply bias adjustments
    biasEntries.forEach(bias => {
      const nomineeId = bias.nomineeId.toString();
      
      if (countsMap.has(nomineeId)) {
        // Update existing nominee
        const existing = countsMap.get(nomineeId);
        existing.count += bias.biasAmount;
        existing.biasAmount = bias.biasAmount;
        existing.hasBias = true;
        existing.biasReason = bias.reason;
      } else {
        // Add nominee that only has bias votes (no regular votes)
        countsMap.set(nomineeId, {
          nomineeId: nomineeId,
          nomineeName: bias.nominee?.name || 'Unknown Nominee',
          count: bias.biasAmount,
          originalCount: 0,
          biasAmount: bias.biasAmount,
          hasBias: true,
          biasReason: bias.reason
        });
      }
    });
    
    // Convert back to array and sort by total count (descending)
    return Array.from(countsMap.values())
      .sort((a, b) => b.count - a.count);
  }

  /**
   * Get vote counts without bias (original counts only)
   * @param {string} awardId - Award ID
   * @returns {Promise<Array>} Original vote counts without bias
   */
  async getOriginalVoteCountsForAward(awardId) {
    try {
      console.log(`Getting original vote counts (no bias) for award: ${awardId}`);
      
      // Get original counts directly from database without bias
      const counts = await withDatabaseCircuitBreaker(
        async () => {
          return await Vote.getVoteCountsForAward(awardId);
        },
        // Fallback: return empty array if database is unavailable
        async () => {
          console.warn('Database unavailable for original vote counts, returning empty results');
          return [];
        }
      );
      
      return counts;
    } catch (error) {
      console.error('Error getting original vote counts:', error);
      const serviceError = new Error('Failed to retrieve original vote counts');
      serviceError.statusCode = 503;
      serviceError.code = 'ORIGINAL_VOTE_COUNTS_UNAVAILABLE';
      serviceError.retryable = true;
      serviceError.retryAfter = 30;
      throw serviceError;
    }
  }

  /**
   * Get user's voting history with circuit breaker
   * @param {string} userId - User ID
   * @returns {Promise<Array>} User's vote history
   */
  async getUserVotingHistory(userId) {
    try {
      return await withDatabaseCircuitBreaker(
        async () => {
          return await Vote.getUserVotingHistory(userId);
        },
        // Fallback: return empty array if database is unavailable
        async () => {
          console.warn('Database unavailable for voting history, returning empty results');
          return [];
        }
      );
    } catch (error) {
      console.error('Error getting user voting history:', error);
      const serviceError = new Error('Failed to retrieve voting history');
      serviceError.statusCode = 503;
      serviceError.code = 'VOTING_HISTORY_UNAVAILABLE';
      serviceError.retryable = true;
      serviceError.retryAfter = 30;
      throw serviceError;
    }
  }

  /**
   * Check if user has voted for a specific award with circuit breaker
   * @param {string} userId - User ID
   * @param {string} awardId - Award ID
   * @returns {Promise<Object|null>} Existing vote or null
   */
  async checkUserVoteForAward(userId, awardId) {
    try {
      return await withDatabaseCircuitBreaker(
        async () => {
          return await Vote.hasUserVotedForAward(userId, awardId);
        },
        // Fallback: return null if database is unavailable
        async () => {
          console.warn('Database unavailable for vote check, returning null');
          return null;
        }
      );
    } catch (error) {
      console.error('Error checking user vote:', error);
      const serviceError = new Error('Failed to check voting status');
      serviceError.statusCode = 503;
      serviceError.code = 'VOTE_CHECK_UNAVAILABLE';
      serviceError.retryable = true;
      serviceError.retryAfter = 30;
      throw serviceError;
    }
  }

  /**
   * Update vote counts in Redis cache with atomic operations
   * @param {string} awardId - Award ID
   * @param {string} nomineeId - Nominee ID
   * @param {number} maxRetries - Maximum retry attempts
   * @private
   */
  async updateVoteCountsInCache(awardId, nomineeId, maxRetries = 3) {
    let lastError = null;
    
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        // Use atomic increment with distributed locking
        await redisService.atomicVoteIncrement(awardId, nomineeId);
        return; // Success
      } catch (error) {
        lastError = error;
        console.error(`Redis cache update attempt ${attempt}/${maxRetries} failed:`, error);
        
        if (attempt < maxRetries) {
          // Exponential backoff: 100ms, 200ms, 400ms
          const delayMs = 100 * Math.pow(2, attempt - 1);
          await new Promise(resolve => setTimeout(resolve, delayMs));
        }
      }
    }
    
    // All retries failed
    console.error(`Redis cache update failed after ${maxRetries} attempts:`, lastError);
    // Don't throw - cache failures shouldn't break vote submission
  }

  /**
   * Get vote counts from Redis cache
   * @param {string} awardId - Award ID
   * @returns {Promise<Array|null>} Cached vote counts or null
   * @private
   */
  async getVoteCountsFromCache(awardId) {
    try {
      const cachedData = await redisService.getVoteCounts(awardId);
      if (!cachedData || Object.keys(cachedData).length === 0) {
        return null;
      }

      // Convert Redis hash to expected format
      const counts = [];
      for (const [nomineeId, count] of Object.entries(cachedData)) {
        // Get nominee details
        const nominee = await Nominee.findById(nomineeId);
        if (nominee) {
          counts.push({
            nomineeId,
            nomineeName: nominee.name,
            count: parseInt(count, 10)
          });
        }
      }

      return counts;
    } catch (error) {
      console.error('Redis cache read failed:', error);
      return null;
    }
  }

  /**
   * Cache vote counts in Redis
   * @param {string} awardId - Award ID
   * @param {Array} counts - Vote counts to cache
   * @private
   */
  async cacheVoteCounts(awardId, counts) {
    try {
      if (!counts || counts.length === 0) {
        return;
      }

      // Convert counts array to Redis hash format
      const countsMap = {};
      for (const count of counts) {
        countsMap[count.nomineeId] = count.count.toString();
      }

      // Set all counts at once using HMSET
      await redisService.setMultipleVoteCounts(awardId, countsMap);
    } catch (error) {
      console.error('Redis cache write failed:', error);
      // Don't throw - cache failures shouldn't break the operation
    }
  }

  /**
   * Warm cache for all active awards
   * @returns {Promise<Object>} Cache warming results
   */
  async warmVoteCountsCache() {
    try {
      const Award = require('../models/Award');
      const activeAwards = await Award.find({ isActive: true }).select('_id');
      
      const results = {
        success: 0,
        failed: 0,
        total: activeAwards.length,
        errors: []
      };

      for (const award of activeAwards) {
        try {
          const awardId = award._id.toString();
          
          // Get actual counts from database
          const counts = await Vote.getVoteCountsForAward(awardId);
          
          // Cache the counts
          await this.cacheVoteCounts(awardId, counts);
          
          results.success++;
        } catch (error) {
          console.error(`Failed to warm cache for award ${award._id}:`, error);
          results.failed++;
          results.errors.push({
            awardId: award._id.toString(),
            error: error.message
          });
        }
      }

      console.log(`Cache warming completed: ${results.success}/${results.total} awards cached successfully`);
      return results;
    } catch (error) {
      console.error('Cache warming failed:', error);
      throw new Error('Failed to warm vote counts cache');
    }
  }

  /**
   * Warm cache for a specific award
   * @param {string} awardId - Award ID
   * @returns {Promise<boolean>} Success status
   */
  async warmVoteCountsCacheForAward(awardId) {
    try {
      // Get actual counts from database
      const counts = await Vote.getVoteCountsForAward(awardId);
      
      // Cache the counts
      await this.cacheVoteCounts(awardId, counts);
      
      console.log(`Cache warmed for award ${awardId}: ${counts.length} nominees`);
      return true;
    } catch (error) {
      console.error(`Failed to warm cache for award ${awardId}:`, error);
      return false;
    }
  }

  /**
   * Clear vote counts cache for an award
   * @param {string} awardId - Award ID
   * @returns {Promise<boolean>} Success status
   */
  async clearVoteCountsCache(awardId) {
    try {
      await redisService.deleteVoteCounts(awardId);
      console.log(`Cache cleared for award ${awardId}`);
      return true;
    } catch (error) {
      console.error(`Failed to clear cache for award ${awardId}:`, error);
      return false;
    }
  }

  /**
   * Verify cache-database consistency for an award
   * @param {string} awardId - Award ID
   * @returns {Promise<Object>} Consistency check results
   */
  async verifyCacheConsistency(awardId) {
    try {
      // Get counts from both sources
      const [dbCounts, cacheCounts] = await Promise.all([
        Vote.getVoteCountsForAward(awardId),
        this.getVoteCountsFromCache(awardId)
      ]);

      // Convert to maps for easier comparison
      const dbCountsMap = new Map();
      dbCounts.forEach(count => {
        dbCountsMap.set(count.nomineeId, count.count);
      });

      const cacheCountsMap = new Map();
      if (cacheCounts) {
        cacheCounts.forEach(count => {
          cacheCountsMap.set(count.nomineeId, count.count);
        });
      }

      // Find discrepancies
      const discrepancies = [];
      const allNomineeIds = new Set([...dbCountsMap.keys(), ...cacheCountsMap.keys()]);

      for (const nomineeId of allNomineeIds) {
        const dbCount = dbCountsMap.get(nomineeId) || 0;
        const cacheCount = cacheCountsMap.get(nomineeId) || 0;

        if (dbCount !== cacheCount) {
          discrepancies.push({
            nomineeId,
            databaseCount: dbCount,
            cacheCount,
            difference: dbCount - cacheCount
          });
        }
      }

      return {
        awardId,
        consistent: discrepancies.length === 0,
        totalNominees: allNomineeIds.size,
        discrepancies,
        databaseTotal: Array.from(dbCountsMap.values()).reduce((sum, count) => sum + count, 0),
        cacheTotal: Array.from(cacheCountsMap.values()).reduce((sum, count) => sum + count, 0)
      };

    } catch (error) {
      console.error(`Failed to verify cache consistency for award ${awardId}:`, error);
      throw new Error(`Cache consistency check failed: ${error.message}`);
    }
  }

  /**
   * Verify cache-database consistency for all active awards
   * @returns {Promise<Object>} Overall consistency results
   */
  async verifyAllCacheConsistency() {
    try {
      const Award = require('../models/Award');
      const activeAwards = await Award.find({ isActive: true }).select('_id title');
      
      const results = {
        totalAwards: activeAwards.length,
        consistentAwards: 0,
        inconsistentAwards: 0,
        awards: [],
        errors: []
      };

      for (const award of activeAwards) {
        try {
          const awardId = award._id.toString();
          const consistency = await this.verifyCacheConsistency(awardId);
          
          results.awards.push({
            awardId,
            title: award.title,
            ...consistency
          });

          if (consistency.consistent) {
            results.consistentAwards++;
          } else {
            results.inconsistentAwards++;
          }

        } catch (error) {
          console.error(`Failed to check consistency for award ${award._id}:`, error);
          results.errors.push({
            awardId: award._id.toString(),
            title: award.title,
            error: error.message
          });
        }
      }

      return results;
    } catch (error) {
      console.error('Failed to verify cache consistency for all awards:', error);
      throw new Error('Overall cache consistency check failed');
    }
  }

  /**
   * Synchronize cache with database for an award
   * @param {string} awardId - Award ID
   * @param {boolean} forceRebuild - Whether to force cache rebuild
   * @returns {Promise<Object>} Synchronization results
   */
  async synchronizeCacheForAward(awardId, forceRebuild = false) {
    try {
      let consistency = null;
      
      if (!forceRebuild) {
        // Check consistency first
        consistency = await this.verifyCacheConsistency(awardId);
        
        if (consistency.consistent) {
          return {
            awardId,
            action: 'none',
            message: 'Cache is already consistent with database',
            consistency
          };
        }
      }

      // Clear cache and rebuild from database
      await this.clearVoteCountsCache(awardId);
      const success = await this.warmVoteCountsCacheForAward(awardId);

      if (!success) {
        throw new Error('Failed to rebuild cache from database');
      }

      // Verify the synchronization worked
      const newConsistency = await this.verifyCacheConsistency(awardId);

      return {
        awardId,
        action: 'synchronized',
        message: 'Cache synchronized with database',
        previousConsistency: consistency,
        newConsistency,
        success: newConsistency.consistent
      };

    } catch (error) {
      console.error(`Failed to synchronize cache for award ${awardId}:`, error);
      throw new Error(`Cache synchronization failed: ${error.message}`);
    }
  }

  /**
   * Synchronize cache with database for all awards
   * @param {boolean} forceRebuild - Whether to force cache rebuild for all awards
   * @returns {Promise<Object>} Overall synchronization results
   */
  async synchronizeAllCaches(forceRebuild = false) {
    try {
      const Award = require('../models/Award');
      const activeAwards = await Award.find({ isActive: true }).select('_id title');
      
      const results = {
        totalAwards: activeAwards.length,
        synchronized: 0,
        alreadyConsistent: 0,
        failed: 0,
        awards: [],
        errors: []
      };

      for (const award of activeAwards) {
        try {
          const awardId = award._id.toString();
          const syncResult = await this.synchronizeCacheForAward(awardId, forceRebuild);
          
          results.awards.push({
            awardId,
            title: award.title,
            ...syncResult
          });

          if (syncResult.action === 'synchronized') {
            results.synchronized++;
          } else if (syncResult.action === 'none') {
            results.alreadyConsistent++;
          }

        } catch (error) {
          console.error(`Failed to synchronize cache for award ${award._id}:`, error);
          results.failed++;
          results.errors.push({
            awardId: award._id.toString(),
            title: award.title,
            error: error.message
          });
        }
      }

      return results;
    } catch (error) {
      console.error('Failed to synchronize all caches:', error);
      throw new Error('Overall cache synchronization failed');
    }
  }

  /**
   * Background job for periodic cache-database synchronization
   * @param {Object} options - Synchronization options
   * @param {number} options.intervalMs - Interval between checks in milliseconds
   * @param {boolean} options.autoFix - Whether to automatically fix inconsistencies
   * @returns {Promise<void>}
   */
  async startCacheSyncJob(options = {}) {
    const { intervalMs = 300000, autoFix = true } = options; // Default: 5 minutes

    console.log(`Starting cache synchronization job (interval: ${intervalMs}ms, autoFix: ${autoFix})`);

    const runSync = async () => {
      try {
        console.log('Running cache consistency check...');
        const consistency = await this.verifyAllCacheConsistency();
        
        console.log(`Cache consistency check completed: ${consistency.consistentAwards}/${consistency.totalAwards} awards consistent`);

        if (consistency.inconsistentAwards > 0 && autoFix) {
          console.log(`Found ${consistency.inconsistentAwards} inconsistent awards, attempting to fix...`);
          
          // Fix inconsistent awards
          for (const award of consistency.awards) {
            if (!award.consistent) {
              try {
                await this.synchronizeCacheForAward(award.awardId);
                console.log(`Fixed cache inconsistency for award ${award.awardId}`);
              } catch (error) {
                console.error(`Failed to fix cache for award ${award.awardId}:`, error);
              }
            }
          }
        }

      } catch (error) {
        console.error('Cache synchronization job failed:', error);
      }
    };

    // Run immediately
    await runSync();

    // Schedule periodic runs
    const intervalId = setInterval(runSync, intervalMs);

    // Return cleanup function
    return () => {
      clearInterval(intervalId);
      console.log('Cache synchronization job stopped');
    };
  }

  /**
   * Test concurrent vote handling by simulating multiple simultaneous votes
   * @param {Object} testConfig - Test configuration
   * @param {string} testConfig.awardId - Award ID to test
   * @param {Array} testConfig.userIds - Array of user IDs to simulate votes from
   * @param {string} testConfig.nomineeId - Nominee ID to vote for
   * @param {number} testConfig.concurrency - Number of concurrent operations
   * @returns {Promise<Object>} Test results
   */
  async testConcurrentVoting(testConfig) {
    const { awardId, userIds, nomineeId, concurrency = 10 } = testConfig;

    if (!userIds || userIds.length === 0) {
      throw new Error('At least one user ID is required for testing');
    }

    console.log(`Starting concurrent voting test: ${concurrency} operations for award ${awardId}`);

    const startTime = Date.now();
    const results = {
      totalAttempts: concurrency,
      successful: 0,
      failed: 0,
      duplicates: 0,
      errors: [],
      timing: {
        startTime,
        endTime: null,
        durationMs: null
      }
    };

    // Create concurrent vote submission promises
    const votePromises = [];
    
    for (let i = 0; i < concurrency; i++) {
      const userId = userIds[i % userIds.length]; // Cycle through user IDs
      
      const votePromise = this.submitVote({
        userId,
        awardId,
        nomineeId,
        biometricVerified: true,
        ipAddress: `192.168.1.${i + 1}` // Simulate different IP addresses
      }).then(result => {
        results.successful++;
        return { success: true, userId, result };
      }).catch(error => {
        if (error.message.includes('already voted') || error.message.includes('Duplicate vote')) {
          results.duplicates++;
          return { success: false, userId, error: 'duplicate', message: error.message };
        } else {
          results.failed++;
          results.errors.push({
            userId,
            error: error.message,
            timestamp: new Date().toISOString()
          });
          return { success: false, userId, error: 'other', message: error.message };
        }
      });

      votePromises.push(votePromise);
    }

    // Wait for all operations to complete
    const operationResults = await Promise.all(votePromises);

    results.timing.endTime = Date.now();
    results.timing.durationMs = results.timing.endTime - results.timing.startTime;

    // Verify final vote counts
    try {
      const finalCounts = await this.getVoteCountsForAward(awardId);
      const nomineeCount = finalCounts.find(count => count.nomineeId === nomineeId);
      
      results.finalVoteCount = nomineeCount ? nomineeCount.count : 0;
      results.expectedVoteCount = Math.min(results.successful, userIds.length); // Can't exceed unique users
      results.countConsistent = results.finalVoteCount === results.expectedVoteCount;
    } catch (error) {
      results.countVerificationError = error.message;
    }

    console.log(`Concurrent voting test completed in ${results.timing.durationMs}ms`);
    console.log(`Results: ${results.successful} successful, ${results.duplicates} duplicates, ${results.failed} failed`);

    return {
      ...results,
      operationResults
    };
  }

  /**
   * Stress test the voting system with high concurrency
   * @param {Object} stressConfig - Stress test configuration
   * @param {string} stressConfig.awardId - Award ID to test
   * @param {number} stressConfig.userCount - Number of unique users to simulate
   * @param {number} stressConfig.concurrentBatches - Number of concurrent batches
   * @param {number} stressConfig.batchSize - Size of each batch
   * @returns {Promise<Object>} Stress test results
   */
  async stressTestVoting(stressConfig) {
    const { awardId, userCount = 100, concurrentBatches = 5, batchSize = 20 } = stressConfig;

    console.log(`Starting voting stress test: ${concurrentBatches} batches of ${batchSize} operations each`);

    // Generate test user IDs
    const userIds = Array.from({ length: userCount }, (_, i) => `test_user_${i + 1}`);

    const overallResults = {
      totalBatches: concurrentBatches,
      batchSize,
      userCount,
      batchResults: [],
      aggregateStats: {
        totalAttempts: 0,
        totalSuccessful: 0,
        totalDuplicates: 0,
        totalFailed: 0,
        averageDurationMs: 0,
        minDurationMs: Infinity,
        maxDurationMs: 0
      }
    };

    // Run concurrent batches
    const batchPromises = [];
    
    for (let batch = 0; batch < concurrentBatches; batch++) {
      const batchPromise = this.testConcurrentVoting({
        awardId,
        userIds,
        nomineeId: 'test_nominee_1', // Use a test nominee
        concurrency: batchSize
      }).then(result => {
        result.batchNumber = batch + 1;
        return result;
      });

      batchPromises.push(batchPromise);
    }

    const batchResults = await Promise.all(batchPromises);
    overallResults.batchResults = batchResults;

    // Calculate aggregate statistics
    for (const batch of batchResults) {
      overallResults.aggregateStats.totalAttempts += batch.totalAttempts;
      overallResults.aggregateStats.totalSuccessful += batch.successful;
      overallResults.aggregateStats.totalDuplicates += batch.duplicates;
      overallResults.aggregateStats.totalFailed += batch.failed;
      
      overallResults.aggregateStats.minDurationMs = Math.min(
        overallResults.aggregateStats.minDurationMs, 
        batch.timing.durationMs
      );
      overallResults.aggregateStats.maxDurationMs = Math.max(
        overallResults.aggregateStats.maxDurationMs, 
        batch.timing.durationMs
      );
    }

    overallResults.aggregateStats.averageDurationMs = 
      batchResults.reduce((sum, batch) => sum + batch.timing.durationMs, 0) / batchResults.length;

    console.log(`Stress test completed: ${overallResults.aggregateStats.totalSuccessful}/${overallResults.aggregateStats.totalAttempts} successful operations`);

    return overallResults;
  }

  /**
   * Validate vote data structure
   * @param {Object} voteData - Vote data to validate
   * @returns {Object} Validation result
   */
  validateVoteData(voteData) {
    const errors = [];

    if (!voteData.userId) {
      errors.push('userId is required');
    }

    if (!voteData.awardId) {
      errors.push('awardId is required');
    }

    if (!voteData.nomineeId) {
      errors.push('nomineeId is required');
    }

    if (typeof voteData.biometricVerified !== 'boolean') {
      errors.push('biometricVerified must be a boolean value');
    }

    return {
      isValid: errors.length === 0,
      errors
    };
  }
}

module.exports = new VoteService();