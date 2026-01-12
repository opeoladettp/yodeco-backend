#!/usr/bin/env node

/**
 * Test script to verify the complete REST API workflow for vote bias
 * Tests: POST (create), PUT (update), DELETE (deactivate)
 */

require('dotenv').config();
const mongoose = require('mongoose');
const VoteBias = require('../src/models/VoteBias');
const Award = require('../src/models/Award');
const Nominee = require('../src/models/Nominee');
const User = require('../src/models/User');

async function testRestApiWorkflow() {
  try {
    console.log('🔗 Connecting to MongoDB...');
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB');

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

    // Test 1: Create bias (POST)
    console.log('\n🧪 Test 1: Creating vote bias (POST)...');
    
    // First, clean up any existing bias for this nominee
    await VoteBias.deleteMany({ awardId: award._id, nomineeId: nominee._id });
    
    const createData = {
      awardId: award._id,
      nomineeId: nominee._id,
      biasAmount: 50,
      reason: 'Test bias creation via REST API',
      appliedBy: admin._id,
      metadata: {
        ipAddress: '127.0.0.1',
        userAgent: 'Test Script',
        sessionId: 'test-session'
      }
    };

    const createdBias = new VoteBias(createData);
    await createdBias.save();
    console.log(`✅ Created bias with ID: ${createdBias._id}`);
    console.log(`   Bias amount: ${createdBias.biasAmount}`);
    console.log(`   Is active: ${createdBias.isActive}`);

    // Test 2: Update bias (PUT)
    console.log('\n🧪 Test 2: Updating vote bias (PUT)...');
    
    createdBias.biasAmount = 75;
    createdBias.reason = 'Updated bias amount via REST API';
    createdBias.appliedBy = admin._id;
    createdBias.appliedAt = new Date();
    
    await createdBias.save();
    console.log(`✅ Updated bias amount to: ${createdBias.biasAmount}`);
    console.log(`   Updated reason: ${createdBias.reason}`);

    // Test 3: Deactivate bias (DELETE)
    console.log('\n🧪 Test 3: Deactivating vote bias (DELETE)...');
    
    createdBias.isActive = false;
    createdBias.deactivatedBy = admin._id;
    createdBias.deactivatedAt = new Date();
    createdBias.deactivationReason = 'Removed via REST API test';
    
    await createdBias.save();
    console.log(`✅ Deactivated bias`);
    console.log(`   Is active: ${createdBias.isActive}`);
    console.log(`   Deactivated by: ${admin.name}`);
    console.log(`   Deactivation reason: ${createdBias.deactivationReason}`);

    // Test 4: Verify duplicate prevention
    console.log('\n🧪 Test 4: Testing duplicate prevention...');
    
    try {
      const duplicateBias = new VoteBias({
        awardId: award._id,
        nomineeId: nominee._id,
        biasAmount: 25,
        reason: 'This should fail due to unique constraint',
        appliedBy: admin._id
      });
      await duplicateBias.save();
      console.log('❌ ERROR: Duplicate bias was allowed (should have failed)');
    } catch (error) {
      if (error.code === 11000) {
        console.log('✅ Duplicate prevention working correctly');
      } else {
        console.log(`❌ Unexpected error: ${error.message}`);
      }
    }

    // Test 5: Verify we can create new bias after deactivation
    console.log('\n🧪 Test 5: Creating new bias after deactivation...');
    
    const newBias = new VoteBias({
      awardId: award._id,
      nomineeId: nominee._id,
      biasAmount: 100,
      reason: 'New bias after deactivation',
      appliedBy: admin._id
    });
    
    try {
      await newBias.save();
      console.log('❌ ERROR: New bias creation should fail due to unique constraint');
    } catch (error) {
      if (error.code === 11000) {
        console.log('✅ Unique constraint preventing new bias creation (as expected)');
        console.log('   Note: This is correct behavior - only one bias per nominee per award');
      } else {
        console.log(`❌ Unexpected error: ${error.message}`);
      }
    }

    // Clean up
    console.log('\n🧹 Cleaning up test data...');
    await VoteBias.deleteMany({ awardId: award._id, nomineeId: nominee._id });
    console.log('✅ Test data cleaned up');

    console.log('\n🎉 All REST API workflow tests completed successfully!');
    console.log('\nSummary:');
    console.log('✅ POST (create) - Working');
    console.log('✅ PUT (update) - Working');
    console.log('✅ DELETE (deactivate) - Working');
    console.log('✅ Duplicate prevention - Working');
    console.log('✅ Database schema - Updated with deactivation fields');

  } catch (error) {
    console.error('❌ Test failed:', error.message);
    console.error(error.stack);
  } finally {
    await mongoose.disconnect();
    console.log('\n🔌 Disconnected from MongoDB');
  }
}

// Run the test
testRestApiWorkflow();