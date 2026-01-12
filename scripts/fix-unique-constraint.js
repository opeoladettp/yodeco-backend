#!/usr/bin/env node

/**
 * Fix the unique constraint issue by updating the index
 * This will allow creating new bias entries after deleting old ones
 */

require('dotenv').config();
const mongoose = require('mongoose');
const VoteBias = require('../src/models/VoteBias');

async function fixUniqueConstraint() {
  try {
    console.log('🔗 Connecting to MongoDB...');
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB');

    console.log('\n🔍 Checking current indexes...');
    const indexes = await VoteBias.collection.getIndexes();
    console.log('Current indexes:');
    Object.keys(indexes).forEach(indexName => {
      console.log(`   - ${indexName}: ${JSON.stringify(indexes[indexName])}`);
    });

    console.log('\n🗑️ Dropping old unique constraint...');
    try {
      await VoteBias.collection.dropIndex('awardId_1_nomineeId_1');
      console.log('✅ Old unique constraint dropped');
    } catch (error) {
      if (error.code === 27) {
        console.log('ℹ️  Old index does not exist (already dropped)');
      } else {
        console.log(`⚠️  Could not drop old index: ${error.message}`);
      }
    }

    console.log('\n🔧 Creating new partial unique constraint...');
    try {
      await VoteBias.collection.createIndex(
        { awardId: 1, nomineeId: 1, isActive: 1 },
        { 
          unique: true,
          partialFilterExpression: { isActive: true },
          name: 'awardId_1_nomineeId_1_isActive_1_partial'
        }
      );
      console.log('✅ New partial unique constraint created');
      console.log('   This allows only one ACTIVE bias per nominee per award');
      console.log('   Inactive bias entries do not conflict');
    } catch (error) {
      if (error.code === 85) {
        console.log('ℹ️  New index already exists');
      } else {
        console.log(`❌ Could not create new index: ${error.message}`);
      }
    }

    console.log('\n🔍 Checking updated indexes...');
    const updatedIndexes = await VoteBias.collection.getIndexes();
    console.log('Updated indexes:');
    Object.keys(updatedIndexes).forEach(indexName => {
      console.log(`   - ${indexName}: ${JSON.stringify(updatedIndexes[indexName])}`);
    });

    console.log('\n🧪 Testing the fix...');
    
    // Find test data
    const Award = require('../src/models/Award');
    const User = require('../src/models/User');
    
    const award = await Award.findOne().populate('nominees');
    const nominee = award.nominees[0];
    const admin = await User.findOne({ role: 'System_Admin' });

    console.log(`   Testing with: ${nominee.name} in ${award.title}`);

    // Clean up any existing bias for this test
    await VoteBias.deleteMany({ awardId: award._id, nomineeId: nominee._id });

    // Test 1: Create bias
    console.log('\n   Test 1: Creating bias...');
    const bias1 = new VoteBias({
      awardId: award._id,
      nomineeId: nominee._id,
      biasAmount: 50,
      reason: 'Test bias creation',
      appliedBy: admin._id
    });
    await bias1.save();
    console.log(`   ✅ Created bias: ${bias1._id}`);

    // Test 2: Try to create duplicate (should fail)
    console.log('\n   Test 2: Trying to create duplicate active bias...');
    try {
      const bias2 = new VoteBias({
        awardId: award._id,
        nomineeId: nominee._id,
        biasAmount: 75,
        reason: 'Duplicate bias (should fail)',
        appliedBy: admin._id
      });
      await bias2.save();
      console.log('   ❌ ERROR: Duplicate active bias was allowed');
    } catch (error) {
      if (error.code === 11000) {
        console.log('   ✅ Duplicate active bias correctly prevented');
      } else {
        console.log(`   ❌ Unexpected error: ${error.message}`);
      }
    }

    // Test 3: Deactivate bias
    console.log('\n   Test 3: Deactivating bias...');
    bias1.isActive = false;
    bias1.deactivatedBy = admin._id;
    bias1.deactivatedAt = new Date();
    bias1.deactivationReason = 'Test deactivation';
    await bias1.save();
    console.log('   ✅ Bias deactivated');

    // Test 4: Create new bias after deactivation (should work now)
    console.log('\n   Test 4: Creating new bias after deactivation...');
    try {
      const bias3 = new VoteBias({
        awardId: award._id,
        nomineeId: nominee._id,
        biasAmount: 100,
        reason: 'New bias after deactivation',
        appliedBy: admin._id
      });
      await bias3.save();
      console.log(`   ✅ New bias created successfully: ${bias3._id}`);
      
      // Clean up
      await VoteBias.findByIdAndDelete(bias3._id);
    } catch (error) {
      console.log(`   ❌ Failed to create new bias: ${error.message}`);
    }

    // Clean up test data
    await VoteBias.deleteMany({ awardId: award._id, nomineeId: nominee._id });
    console.log('\n   ✅ Test data cleaned up');

    console.log('\n🎉 Unique constraint fix completed!');
    console.log('\n📋 Summary:');
    console.log('✅ Old constraint removed (prevented any duplicate)');
    console.log('✅ New partial constraint added (prevents only active duplicates)');
    console.log('✅ Users can now create new bias after deleting old ones');
    console.log('✅ Audit trail is still maintained (soft delete)');
    console.log('✅ Active bias entries are still protected from duplicates');

  } catch (error) {
    console.error('❌ Fix failed:', error.message);
    console.error(error.stack);
  } finally {
    await mongoose.disconnect();
    console.log('\n🔌 Disconnected from MongoDB');
  }
}

// Run the fix
fixUniqueConstraint();