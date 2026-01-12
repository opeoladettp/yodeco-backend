const mongoose = require('mongoose');
const { Award } = require('../src/models');
const redisService = require('../src/services/redisService');
const voteService = require('../src/services/voteService');

async function testRedisCache() {
  try {
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/biometric-voting');
    console.log('Connected to MongoDB');

    const award = await Award.findOne({ title: /Best Perorming Senetor/ });
    console.log(`\nTesting Redis cache for award: ${award.title} (${award._id})`);

    // Test Redis connection
    console.log('\n=== Testing Redis Connection ===');
    try {
      const testResult = await redisService.executeWithFallback(
        async () => {
          const client = redisService.getClient();
          return await client.ping();
        },
        async () => 'Redis not available'
      );
      console.log(`Redis ping result: ${testResult}`);
    } catch (error) {
      console.log(`Redis connection failed: ${error.message}`);
    }

    // Check current cache contents
    console.log('\n=== Checking Current Cache ===');
    try {
      const cachedCounts = await voteService.getVoteCountsFromCache(award._id.toString());
      if (cachedCounts) {
        console.log('Found cached vote counts:');
        cachedCounts.forEach(count => {
          console.log(`- ${count.nomineeName}: ${count.count} votes`);
        });
      } else {
        console.log('No cached vote counts found');
      }
    } catch (error) {
      console.log(`Cache read failed: ${error.message}`);
    }

    // Clear the cache
    console.log('\n=== Clearing Cache ===');
    try {
      const clearResult = await voteService.clearVoteCountsCache(award._id.toString());
      console.log(`Cache clear result: ${clearResult ? 'Success' : 'Failed'}`);
    } catch (error) {
      console.log(`Cache clear failed: ${error.message}`);
    }

    // Get fresh counts from database
    console.log('\n=== Getting Fresh Counts ===');
    const freshCounts = await voteService.getVoteCountsForAward(award._id.toString());
    console.log('Fresh vote counts from database:');
    freshCounts.forEach(count => {
      console.log(`- ${count.nomineeName}: ${count.count} votes (Original: ${count.originalCount}, Bias: ${count.biasAmount})`);
    });

    // Check cache again after fresh fetch
    console.log('\n=== Checking Cache After Fresh Fetch ===');
    try {
      const newCachedCounts = await voteService.getVoteCountsFromCache(award._id.toString());
      if (newCachedCounts) {
        console.log('New cached vote counts:');
        newCachedCounts.forEach(count => {
          console.log(`- ${count.nomineeName}: ${count.count} votes`);
        });
      } else {
        console.log('No cached vote counts found');
      }
    } catch (error) {
      console.log(`Cache read failed: ${error.message}`);
    }

  } catch (error) {
    console.error('Error:', error);
  } finally {
    await mongoose.disconnect();
  }
}

testRedisCache();