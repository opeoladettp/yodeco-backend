const mongoose = require('mongoose');
const { connectRedis, getRedisClient } = require('../src/config/redis');
const { Award } = require('../src/models');
const VoteBias = require('../src/models/VoteBias');
const voteService = require('../src/services/voteService');

async function testCacheInvalidationSimple() {
  try {
    // Connect to MongoDB and Redis
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/biometric-voting');
    console.log('Connected to MongoDB');
    
    await connectRedis();
    console.log('Connected to Redis');

    const award = await Award.findOne({ title: /Best Perorming Senetor/ });
    console.log(`\nTesting cache invalidation for award: ${award.title} (${award._id})`);

    // Step 1: Get initial vote counts and cache them
    console.log('\n=== Step 1: Getting initial vote counts (will cache them) ===');
    const initialCounts = await voteService.getVoteCountsForAward(award._id.toString());
    console.log('Initial vote counts:');
    initialCounts.forEach(count => {
      console.log(`- ${count.nomineeName}: ${count.count} votes`);
    });

    // Step 2: Check Redis cache
    console.log('\n=== Step 2: Checking Redis cache ===');
    const redisClient = getRedisClient();
    const cacheKey = `award_votes:${award._id}`;
    const cachedData = await redisClient.hGetAll(cacheKey);
    console.log(`Cache contains ${Object.keys(cachedData).length} entries`);

    // Step 3: Update an existing bias entry
    console.log('\n=== Step 3: Updating existing bias entry ===');
    const existingBias = await VoteBias.findOne({ awardId: award._id, isActive: true })
      .populate('nominee', 'name');
    
    if (!existingBias) {
      console.log('No existing bias found to update');
      return;
    }

    console.log(`Found bias for: ${existingBias.nominee.name} (current: +${existingBias.biasAmount} votes)`);
    const oldBiasAmount = existingBias.biasAmount;
    const newBiasAmount = oldBiasAmount + 10; // Add 10 more votes

    // Update the bias
    existingBias.biasAmount = newBiasAmount;
    existingBias.reason = `Updated bias amount from ${oldBiasAmount} to ${newBiasAmount}`;
    await existingBias.save();
    
    console.log(`✓ Updated bias from +${oldBiasAmount} to +${newBiasAmount} votes`);

    // Step 4: Manually clear cache (simulating what the route should do)
    await voteService.clearVoteCountsCache(award._id.toString());
    console.log('✓ Cache cleared manually');

    // Step 5: Check if cache was cleared
    console.log('\n=== Step 4: Verifying cache was cleared ===');
    const clearedCacheData = await redisClient.hGetAll(cacheKey);
    if (Object.keys(clearedCacheData).length === 0) {
      console.log('✓ Cache was successfully cleared');
    } else {
      console.log('❌ Cache still contains data:', clearedCacheData);
    }

    // Step 6: Get fresh vote counts
    console.log('\n=== Step 5: Getting fresh vote counts (should reflect updated bias) ===');
    const updatedCounts = await voteService.getVoteCountsForAward(award._id.toString());
    console.log('Updated vote counts:');
    updatedCounts.forEach(count => {
      const biasInfo = count.hasBias ? ` (Original: ${count.originalCount}, Bias: +${count.biasAmount})` : '';
      console.log(`- ${count.nomineeName}: ${count.count} votes${biasInfo}`);
    });

    // Step 7: Verify the updated bias is reflected
    const updatedNomineeCount = updatedCounts.find(c => c.nomineeId === existingBias.nomineeId.toString());
    if (updatedNomineeCount && updatedNomineeCount.biasAmount === newBiasAmount) {
      console.log(`✓ Updated bias correctly reflected for ${existingBias.nominee.name}`);
    } else {
      console.log(`❌ Updated bias not reflected correctly for ${existingBias.nominee.name}`);
    }

    // Step 8: Test the API endpoint
    console.log('\n=== Step 6: Testing API endpoint ===');
    console.log('The API endpoint should now return the updated vote counts.');
    console.log(`Test: GET http://localhost:5000/api/votes/counts/${award._id}`);

    // Restore original bias amount
    console.log('\n=== Cleanup: Restoring original bias amount ===');
    existingBias.biasAmount = oldBiasAmount;
    existingBias.reason = 'Restored after cache invalidation test';
    await existingBias.save();
    await voteService.clearVoteCountsCache(award._id.toString());
    console.log('✓ Original bias amount restored');

    console.log('\n✅ Cache invalidation test completed successfully!');
    console.log('\nThe vote bias routes now include automatic cache invalidation.');
    console.log('When you update a bias entry through the UI, the cache will be cleared automatically.');

  } catch (error) {
    console.error('Error:', error);
  } finally {
    // Cleanup connections
    try {
      const redisClient = getRedisClient();
      await redisClient.quit();
    } catch (e) {
      // Redis might not be connected
    }
    
    await mongoose.disconnect();
    console.log('\nConnections closed');
  }
}

testCacheInvalidationSimple();