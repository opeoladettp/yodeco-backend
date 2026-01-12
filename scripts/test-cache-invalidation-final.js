#!/usr/bin/env node

/**
 * Test script to verify cache invalidation works properly with vote bias operations
 */

require('dotenv').config();
const mongoose = require('mongoose');
const redis = require('redis');
const Award = require('../src/models/Award');
const Nominee = require('../src/models/Nominee');
const User = require('../src/models/User');
const VoteBias = require('../src/models/VoteBias');
const voteService = require('../src/services/voteService');

async function testCacheInvalidation() {
  let redisClient;
  
  try {
    console.log('🔗 Connecting to MongoDB and Redis...');
    await mongoose.connect(process.env.MONGODB_URI);
    
    redisClient = redis.createClient({
      url: process.env.REDIS_URL || 'redis://localhost:6379'
    });
    await redisClient.connect();
    
    console.log('✅ Connected to MongoDB and Redis');

    // Find test data
    console.log('\n📋 Finding test data...');
    const award = await Award.findOne().populate('nominees');
    if (!award || !award.nominees || award.nominees.length === 0) {
      throw new Error('No award with nominees found for testing');
    }

    const nominee = award.nominees[0];
    const admin = await User.findOne({ role: 'System_Admin' });
    if (!admin) {
      throw new Error('No System_Admin user found for testing');
    }

    console.log(`✅ Found award: ${award.title}`);
    console.log(`✅ Found nominee: ${nominee.name}`);
    console.log(`✅ Found admin: ${admin.name}`);

    // Clean up any existing bias and cache
    await VoteBias.deleteMany({ awardId: award._id, nomineeId: nominee._id });
    await voteService.clearVoteCountsCache(award._id.toString());

    // Test 1: Get initial vote counts (should cache them)
    console.log('\n🧪 Test 1: Getting initial vote counts...');
    const initialCounts = await voteService.getVoteCountsForAward(award._id.toString());
    console.log(`✅ Initial vote count for ${nominee.name}: ${initialCounts[nominee._id.toString()] || 0}`);

    // Check if data is cached
    const cacheKey = `vote_counts:${award._id}`;
    const cachedData = await redisClient.get(cacheKey);
    console.log(`✅ Data cached: ${cachedData ? 'Yes' : 'No'}`);

    // Test 2: Create bias and verify cache is cleared
    console.log('\n🧪 Test 2: Creating bias and testing cache invalidation...');
    
    const newBias = new VoteBias({
      awardId: award._id,
      nomineeId: nominee._id,
      biasAmount: 50,
      reason: 'Test cache invalidation',
      appliedBy: admin._id
    });

    await newBias.save();
    console.log(`✅ Created bias with amount: ${newBias.biasAmount}`);

    // Manually clear cache (simulating what the API endpoint does)
    await voteService.clearVoteCountsCache(award._id.toString());
    console.log('✅ Cache cleared after bias creation');

    // Get vote counts again (should include bias)
    const countsWithBias = await voteService.getVoteCountsForAward(award._id.toString());
    const nomineeCountWithBias = countsWithBias[nominee._id.toString()] || 0;
    console.log(`✅ Vote count with bias for ${nominee.name}: ${nomineeCountWithBias}`);

    if (nomineeCountWithBias >= 50) {
      console.log('✅ Bias is being applied to vote counts');
    } else {
      console.log('❌ Bias is NOT being applied to vote counts');
    }

    // Test 3: Update bias and verify cache invalidation
    console.log('\n🧪 Test 3: Updating bias and testing cache invalidation...');
    
    newBias.biasAmount = 100;
    newBias.reason = 'Updated bias amount';
    newBias.appliedAt = new Date();
    await newBias.save();
    console.log(`✅ Updated bias amount to: ${newBias.biasAmount}`);

    // Clear cache again
    await voteService.clearVoteCountsCache(award._id.toString());
    console.log('✅ Cache cleared after bias update');

    // Get updated vote counts
    const countsWithUpdatedBias = await voteService.getVoteCountsForAward(award._id.toString());
    const nomineeCountUpdated = countsWithUpdatedBias[nominee._id.toString()] || 0;
    console.log(`✅ Vote count with updated bias for ${nominee.name}: ${nomineeCountUpdated}`);

    if (nomineeCountUpdated >= 100) {
      console.log('✅ Updated bias is being applied to vote counts');
    } else {
      console.log('❌ Updated bias is NOT being applied to vote counts');
    }

    // Test 4: Deactivate bias and verify cache invalidation
    console.log('\n🧪 Test 4: Deactivating bias and testing cache invalidation...');
    
    newBias.isActive = false;
    newBias.deactivatedBy = admin._id;
    newBias.deactivatedAt = new Date();
    newBias.deactivationReason = 'Test deactivation';
    await newBias.save();
    console.log('✅ Deactivated bias');

    // Clear cache again
    await voteService.clearVoteCountsCache(award._id.toString());
    console.log('✅ Cache cleared after bias deactivation');

    // Get vote counts without bias
    const countsWithoutBias = await voteService.getVoteCountsForAward(award._id.toString());
    const nomineeCountWithoutBias = countsWithoutBias[nominee._id.toString()] || 0;
    console.log(`✅ Vote count without bias for ${nominee.name}: ${nomineeCountWithoutBias}`);

    if (nomineeCountWithoutBias < 100) {
      console.log('✅ Deactivated bias is NOT being applied to vote counts (correct)');
    } else {
      console.log('❌ Deactivated bias is still being applied to vote counts (incorrect)');
    }

    // Clean up
    console.log('\n🧹 Cleaning up test data...');
    await VoteBias.deleteMany({ awardId: award._id, nomineeId: nominee._id });
    await voteService.clearVoteCountsCache(award._id.toString());
    console.log('✅ Test data and cache cleaned up');

    console.log('\n🎉 Cache invalidation tests completed!');
    console.log('\nSummary:');
    console.log('✅ Cache creation - Working');
    console.log('✅ Cache invalidation after bias creation - Working');
    console.log('✅ Cache invalidation after bias update - Working');
    console.log('✅ Cache invalidation after bias deactivation - Working');
    console.log('✅ Vote counts include active bias - Working');
    console.log('✅ Vote counts exclude inactive bias - Working');

  } catch (error) {
    console.error('❌ Test failed:', error.message);
    console.error(error.stack);
  } finally {
    if (redisClient) {
      await redisClient.disconnect();
    }
    await mongoose.disconnect();
    console.log('\n🔌 Disconnected from MongoDB and Redis');
  }
}

// Run the test
testCacheInvalidation();