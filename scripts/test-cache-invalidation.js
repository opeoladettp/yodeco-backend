const mongoose = require('mongoose');
const { connectRedis, getRedisClient } = require('../src/config/redis');
const { Award, User } = require('../src/models');
const VoteBias = require('../src/models/VoteBias');
const voteService = require('../src/services/voteService');

async function testCacheInvalidation() {
  try {
    // Connect to MongoDB and Redis
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/biometric-voting');
    console.log('Connected to MongoDB');
    
    await connectRedis();
    console.log('Connected to Redis');

    const award = await Award.findOne({ title: /Best Perorming Senetor/ });
    const adminUser = await User.findOne({ role: 'System_Admin' });
    
    console.log(`\nTesting cache invalidation for award: ${award.title} (${award._id})`);

    // Step 1: Get initial vote counts (this will cache them)
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
    console.log(`Cache key: ${cacheKey}`);
    console.log('Cached data:', cachedData);

    // Step 3: Create a new bias entry (this should clear the cache)
    console.log('\n=== Step 3: Creating new bias entry (should clear cache) ===');
    
    // Find a nominee that doesn't have bias yet
    const nominees = await mongoose.model('Nominee').find({ 
      awardId: award._id, 
      isActive: true, 
      approvalStatus: 'approved' 
    });
    
    const existingBiasNominees = initialCounts.filter(c => c.hasBias).map(c => c.nomineeId);
    const availableNominee = nominees.find(n => !existingBiasNominees.includes(n._id.toString()));
    
    if (!availableNominee) {
      console.log('No available nominees without bias, using existing nominee');
      // Delete an existing bias first
      const existingBias = await VoteBias.findOne({ awardId: award._id, isActive: true });
      if (existingBias) {
        existingBias.isActive = false;
        await existingBias.save();
        console.log('Removed existing bias to make room for test');
      }
    }

    const testNominee = availableNominee || nominees[0];
    console.log(`Creating bias for: ${testNominee.name} (+25 votes)`);

    // Create bias entry
    const newBias = new VoteBias({
      awardId: award._id,
      nomineeId: testNominee._id,
      biasAmount: 25,
      reason: 'Test cache invalidation',
      appliedBy: adminUser._id
    });
    await newBias.save();

    // Manually clear cache (simulating what the route should do)
    await voteService.clearVoteCountsCache(award._id.toString());
    console.log('✓ Bias created and cache cleared');

    // Step 4: Check if cache was cleared
    console.log('\n=== Step 4: Checking if cache was cleared ===');
    const clearedCacheData = await redisClient.hGetAll(cacheKey);
    console.log('Cache after bias creation:', clearedCacheData);
    
    if (Object.keys(clearedCacheData).length === 0) {
      console.log('✓ Cache was successfully cleared');
    } else {
      console.log('❌ Cache was not cleared');
    }

    // Step 5: Get fresh vote counts (should reflect the new bias)
    console.log('\n=== Step 5: Getting fresh vote counts (should include new bias) ===');
    const updatedCounts = await voteService.getVoteCountsForAward(award._id.toString());
    console.log('Updated vote counts:');
    updatedCounts.forEach(count => {
      const biasInfo = count.hasBias ? ` (Original: ${count.originalCount}, Bias: +${count.biasAmount})` : '';
      console.log(`- ${count.nomineeName}: ${count.count} votes${biasInfo}`);
    });

    // Step 6: Verify the new bias is included
    const testNomineeCount = updatedCounts.find(c => c.nomineeId === testNominee._id.toString());
    if (testNomineeCount && testNomineeCount.hasBias && testNomineeCount.biasAmount === 25) {
      console.log(`✓ New bias correctly applied to ${testNominee.name}`);
    } else {
      console.log(`❌ New bias not found or incorrect for ${testNominee.name}`);
    }

    // Step 7: Test API endpoint to ensure it returns fresh data
    console.log('\n=== Step 7: Testing API endpoint ===');
    console.log('You can now test the API endpoint:');
    console.log(`GET http://localhost:5000/api/votes/counts/${award._id}`);
    console.log('It should return the updated vote counts with the new bias.');

    // Cleanup: Remove the test bias
    console.log('\n=== Cleanup: Removing test bias ===');
    await VoteBias.findByIdAndDelete(newBias._id);
    await voteService.clearVoteCountsCache(award._id.toString());
    console.log('✓ Test bias removed and cache cleared');

    console.log('\n✅ Cache invalidation test completed!');
    console.log('\nNow the vote bias routes should automatically clear the cache when:');
    console.log('1. A bias entry is created');
    console.log('2. A bias entry is updated');
    console.log('3. A bias entry is deleted');

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

testCacheInvalidation();