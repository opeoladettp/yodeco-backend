const { getRedisClient } = require('../config/redis');
const { withRedisCircuitBreaker } = require('../utils/circuitBreaker');

class RedisService {
  constructor() {
    this.client = null;
    this.fallbackEnabled = true;
  }

  getClient() {
    if (!this.client) {
      this.client = getRedisClient();
    }
    return this.client;
  }

  // Wrapper for Redis operations with circuit breaker and fallback
  async executeWithFallback(operation, fallback = null) {
    try {
      return await withRedisCircuitBreaker(operation, fallback);
    } catch (error) {
      console.warn('Redis operation failed, using fallback if available:', error.message);
      if (fallback && this.fallbackEnabled) {
        return await fallback();
      }
      throw error;
    }
  }

  // Token blacklist operations
  async blacklistToken(tokenId, expiresIn) {
    const operation = async () => {
      const client = this.getClient();
      await client.setEx(`blacklist:${tokenId}`, expiresIn, 'true');
    };
    
    const fallback = async () => {
      // Fallback: Store in memory (not persistent but better than nothing)
      console.warn('Using in-memory fallback for token blacklist');
      if (!this.memoryBlacklist) {
        this.memoryBlacklist = new Map();
      }
      this.memoryBlacklist.set(tokenId, Date.now() + (expiresIn * 1000));
    };
    
    return this.executeWithFallback(operation, fallback);
  }

  async isTokenBlacklisted(tokenId) {
    const operation = async () => {
      const client = this.getClient();
      const result = await client.get(`blacklist:${tokenId}`);
      return result !== null;
    };
    
    const fallback = async () => {
      // Check in-memory fallback
      if (this.memoryBlacklist && this.memoryBlacklist.has(tokenId)) {
        const expiry = this.memoryBlacklist.get(tokenId);
        if (Date.now() < expiry) {
          return true;
        } else {
          this.memoryBlacklist.delete(tokenId);
          return false;
        }
      }
      return false;
    };
    
    return this.executeWithFallback(operation, fallback);
  }

  // Token family management
  async revokeTokenFamily(tokenFamily, expiresIn = 604800) {
    const operation = async () => {
      const client = this.getClient();
      await client.setEx(`revoked_family:${tokenFamily}`, expiresIn, 'revoked');
    };
    
    const fallback = async () => {
      console.warn('Using in-memory fallback for token family revocation');
      if (!this.memoryRevokedFamilies) {
        this.memoryRevokedFamilies = new Map();
      }
      this.memoryRevokedFamilies.set(tokenFamily, Date.now() + (expiresIn * 1000));
    };
    
    return this.executeWithFallback(operation, fallback);
  }

  async isTokenFamilyRevoked(tokenFamily) {
    const operation = async () => {
      const client = this.getClient();
      const result = await client.get(`revoked_family:${tokenFamily}`);
      return result !== null;
    };
    
    const fallback = async () => {
      if (this.memoryRevokedFamilies && this.memoryRevokedFamilies.has(tokenFamily)) {
        const expiry = this.memoryRevokedFamilies.get(tokenFamily);
        if (Date.now() < expiry) {
          return true;
        } else {
          this.memoryRevokedFamilies.delete(tokenFamily);
          return false;
        }
      }
      return false;
    };
    
    return this.executeWithFallback(operation, fallback);
  }

  async trackTokenUsage(tokenId, tokenFamily, expiresIn = 604800) {
    const operation = async () => {
      const client = this.getClient();
      const key = `used_token:${tokenId}`;
      
      // Try to set the key with NX (only if not exists)
      const result = await client.set(key, tokenFamily, 'EX', expiresIn, 'NX');
      
      // If result is null, key already existed (token reuse detected)
      return result === null;
    };
    
    const fallback = async () => {
      console.warn('Using in-memory fallback for token usage tracking');
      if (!this.memoryUsedTokens) {
        this.memoryUsedTokens = new Map();
      }
      
      if (this.memoryUsedTokens.has(tokenId)) {
        return true; // Token reuse detected
      }
      
      this.memoryUsedTokens.set(tokenId, {
        family: tokenFamily,
        expiry: Date.now() + (expiresIn * 1000)
      });
      return false;
    };
    
    return this.executeWithFallback(operation, fallback);
  }

  // Vote counting operations with database fallback
  async incrementVoteCount(awardId, nomineeId) {
    const operation = async () => {
      const client = this.getClient();
      return await client.hIncrBy(`award_votes:${awardId}`, nomineeId, 1);
    };
    
    const fallback = async () => {
      console.warn('Redis unavailable for vote counting, falling back to database query');
      // This would require database access - will be handled by vote service
      throw new Error('Redis unavailable and database fallback not implemented at this level');
    };
    
    return this.executeWithFallback(operation, fallback);
  }

  async getVoteCounts(awardId) {
    const operation = async () => {
      const client = this.getClient();
      return await client.hGetAll(`award_votes:${awardId}`);
    };
    
    const fallback = async () => {
      console.warn('Redis unavailable for vote counts, falling back to database aggregation');
      // This would require database access - will be handled by vote service
      throw new Error('Redis unavailable and database fallback not implemented at this level');
    };
    
    return this.executeWithFallback(operation, fallback);
  }

  async setVoteCount(awardId, nomineeId, count) {
    const operation = async () => {
      const client = this.getClient();
      return await client.hSet(`award_votes:${awardId}`, nomineeId, count);
    };
    
    return this.executeWithFallback(operation);
  }

  async setMultipleVoteCounts(awardId, countsMap) {
    const operation = async () => {
      const client = this.getClient();
      if (Object.keys(countsMap).length === 0) {
        return;
      }
      // Use individual hSet calls for compatibility
      const promises = Object.entries(countsMap).map(([field, value]) => 
        client.hSet(`award_votes:${awardId}`, field, value)
      );
      return await Promise.all(promises);
    };
    
    return this.executeWithFallback(operation);
  }

  async deleteVoteCounts(awardId) {
    const operation = async () => {
      const client = this.getClient();
      return await client.del(`award_votes:${awardId}`);
    };
    
    return this.executeWithFallback(operation);
  }

  async getAllVoteCountKeys() {
    const operation = async () => {
      const client = this.getClient();
      return await client.keys('award_votes:*');
    };
    
    return this.executeWithFallback(operation);
  }

  // Distributed locking operations
  async acquireLock(lockKey, ttlSeconds = 30, retryDelayMs = 100, maxRetries = 50) {
    const operation = async () => {
      const client = this.getClient();
      const lockValue = `${Date.now()}-${Math.random()}`;
      
      for (let attempt = 0; attempt < maxRetries; attempt++) {
        try {
          // Try to acquire lock with NX (only if not exists) and EX (expiration)
          const result = await client.set(lockKey, lockValue, 'EX', ttlSeconds, 'NX');
          
          if (result === 'OK') {
            return {
              acquired: true,
              lockValue,
              lockKey,
              ttlSeconds
            };
          }
          
          // Lock not acquired, wait before retry
          if (attempt < maxRetries - 1) {
            await new Promise(resolve => setTimeout(resolve, retryDelayMs));
          }
          
        } catch (error) {
          console.error(`Lock acquisition attempt ${attempt + 1} failed:`, error);
          if (attempt < maxRetries - 1) {
            await new Promise(resolve => setTimeout(resolve, retryDelayMs));
          }
        }
      }
      
      return {
        acquired: false,
        lockKey,
        error: 'Failed to acquire lock after maximum retries'
      };
    };
    
    const fallback = async () => {
      console.warn('Redis unavailable for locking, using in-memory fallback');
      if (!this.memoryLocks) {
        this.memoryLocks = new Map();
      }
      
      const lockValue = `${Date.now()}-${Math.random()}`;
      
      if (this.memoryLocks.has(lockKey)) {
        const existingLock = this.memoryLocks.get(lockKey);
        if (Date.now() < existingLock.expiry) {
          return {
            acquired: false,
            lockKey,
            error: 'Lock already held in memory'
          };
        }
      }
      
      this.memoryLocks.set(lockKey, {
        value: lockValue,
        expiry: Date.now() + (ttlSeconds * 1000)
      });
      
      return {
        acquired: true,
        lockValue,
        lockKey,
        ttlSeconds
      };
    };
    
    return this.executeWithFallback(operation, fallback);
  }

  async releaseLock(lockKey, lockValue) {
    const operation = async () => {
      const client = this.getClient();
      
      try {
        // Simple approach: check and delete separately (not atomic but works for testing)
        const currentValue = await client.get(lockKey);
        if (currentValue === lockValue) {
          const result = await client.del(lockKey);
          return result === 1;
        }
        return false;
      } catch (error) {
        console.error('Lock release failed:', error);
        return false;
      }
    };
    
    const fallback = async () => {
      if (this.memoryLocks && this.memoryLocks.has(lockKey)) {
        const lock = this.memoryLocks.get(lockKey);
        if (lock.value === lockValue) {
          this.memoryLocks.delete(lockKey);
          return true;
        }
      }
      return false;
    };
    
    return this.executeWithFallback(operation, fallback);
  }

  async extendLock(lockKey, lockValue, additionalTtlSeconds) {
    const operation = async () => {
      const client = this.getClient();
      
      try {
        // Simple approach: check and extend separately (not atomic but works for testing)
        const currentValue = await client.get(lockKey);
        if (currentValue === lockValue) {
          const result = await client.expire(lockKey, additionalTtlSeconds);
          return result === 1;
        }
        return false;
      } catch (error) {
        console.error('Lock extension failed:', error);
        return false;
      }
    };
    
    const fallback = async () => {
      if (this.memoryLocks && this.memoryLocks.has(lockKey)) {
        const lock = this.memoryLocks.get(lockKey);
        if (lock.value === lockValue) {
          lock.expiry = Date.now() + (additionalTtlSeconds * 1000);
          return true;
        }
      }
      return false;
    };
    
    return this.executeWithFallback(operation, fallback);
  }

  // Atomic vote operations with locking
  async atomicVoteIncrement(awardId, nomineeId, lockTtlSeconds = 10) {
    const lockKey = `vote_lock:${awardId}:${nomineeId}`;
    const lock = await this.acquireLock(lockKey, lockTtlSeconds);
    
    if (!lock.acquired) {
      throw new Error(`Failed to acquire vote lock for award ${awardId}, nominee ${nomineeId}`);
    }
    
    try {
      // Perform the increment operation
      const newCount = await this.incrementVoteCount(awardId, nomineeId);
      return newCount;
    } finally {
      // Always release the lock
      await this.releaseLock(lockKey, lock.lockValue);
    }
  }

  // Rate limiting operations
  async checkRateLimit(key, windowMs, maxRequests) {
    const operation = async () => {
      const client = this.getClient();
      const current = await client.incr(key);
      
      if (current === 1) {
        await client.pExpire(key, windowMs);
      }
      
      return {
        count: current,
        remaining: Math.max(0, maxRequests - current),
        exceeded: current > maxRequests
      };
    };
    
    const fallback = async () => {
      console.warn('Using in-memory fallback for rate limiting');
      if (!this.memoryRateLimit) {
        this.memoryRateLimit = new Map();
      }
      
      const now = Date.now();
      const windowStart = now - windowMs;
      
      if (!this.memoryRateLimit.has(key)) {
        this.memoryRateLimit.set(key, []);
      }
      
      const requests = this.memoryRateLimit.get(key);
      // Remove old requests outside the window
      const validRequests = requests.filter(timestamp => timestamp > windowStart);
      validRequests.push(now);
      this.memoryRateLimit.set(key, validRequests);
      
      const count = validRequests.length;
      return {
        count,
        remaining: Math.max(0, maxRequests - count),
        exceeded: count > maxRequests
      };
    };
    
    return this.executeWithFallback(operation, fallback);
  }

  // Session management
  async setSession(sessionId, data, expiresIn) {
    const operation = async () => {
      const client = this.getClient();
      await client.setEx(`session:${sessionId}`, expiresIn, JSON.stringify(data));
    };
    
    return this.executeWithFallback(operation);
  }

  async getSession(sessionId) {
    const operation = async () => {
      const client = this.getClient();
      const data = await client.get(`session:${sessionId}`);
      return data ? JSON.parse(data) : null;
    };
    
    return this.executeWithFallback(operation);
  }

  async deleteSession(sessionId) {
    const operation = async () => {
      const client = this.getClient();
      await client.del(`session:${sessionId}`);
    };
    
    return this.executeWithFallback(operation);
  }

  // Health check
  async ping() {
    const operation = async () => {
      const client = this.getClient();
      return await client.ping();
    };
    
    return this.executeWithFallback(operation);
  }

  // Clean up expired memory fallback data
  cleanupMemoryFallbacks() {
    const now = Date.now();
    
    // Clean up blacklisted tokens
    if (this.memoryBlacklist) {
      for (const [tokenId, expiry] of this.memoryBlacklist.entries()) {
        if (now >= expiry) {
          this.memoryBlacklist.delete(tokenId);
        }
      }
    }
    
    // Clean up revoked families
    if (this.memoryRevokedFamilies) {
      for (const [family, expiry] of this.memoryRevokedFamilies.entries()) {
        if (now >= expiry) {
          this.memoryRevokedFamilies.delete(family);
        }
      }
    }
    
    // Clean up used tokens
    if (this.memoryUsedTokens) {
      for (const [tokenId, data] of this.memoryUsedTokens.entries()) {
        if (now >= data.expiry) {
          this.memoryUsedTokens.delete(tokenId);
        }
      }
    }
    
    // Clean up locks
    if (this.memoryLocks) {
      for (const [lockKey, lock] of this.memoryLocks.entries()) {
        if (now >= lock.expiry) {
          this.memoryLocks.delete(lockKey);
        }
      }
    }
  }

  // Get fallback status for monitoring
  getFallbackStatus() {
    return {
      fallbackEnabled: this.fallbackEnabled,
      memoryBlacklistSize: this.memoryBlacklist ? this.memoryBlacklist.size : 0,
      memoryRevokedFamiliesSize: this.memoryRevokedFamilies ? this.memoryRevokedFamilies.size : 0,
      memoryUsedTokensSize: this.memoryUsedTokens ? this.memoryUsedTokens.size : 0,
      memoryLocksSize: this.memoryLocks ? this.memoryLocks.size : 0,
      memoryRateLimitSize: this.memoryRateLimit ? this.memoryRateLimit.size : 0
    };
  }
}

module.exports = new RedisService();