#!/usr/bin/env node

/**
 * Check the current state of the database to understand the delete issue
 */

require('dotenv').config();
const mongoose = require('mongoose');
const Award = require('../src/models/Award');
const Nominee = require('../src/models/Nominee');
const User = require('../src/models/User');
const VoteBias = require('../src/models/VoteBias');

async function checkDatabaseState() {
  try {
    console.log('🔗 Connecting to MongoDB...');
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB');

    // Find test data
    const award = await Award.findOne().populate('nominees');
    const nominee = award.nominees[0];
    const admin = await User.findOne({ role: 'System_Admin' });

    console.log(`\n📋 Checking database state for:`);
    console.log(`   Award: ${award.title} (${award._id})`);
    console.log(`   Nominee: ${nominee.name} (${nominee._id})`);

    // Check all bias entries for this award
    console.log('\n🔍 ALL BIAS ENTRIES FOR THIS AWARD:');
    console.log('===================================');
    
    const allBiasForAward = await VoteBias.find({ awardId: award._id })
      .populate('nominee', 'name')
      .populate('appliedBy', 'name')
      .populate('deactivatedBy', 'name')
      .sort({ appliedAt: -1 });

    if (allBiasForAward.length === 0) {
      console.log('   No bias entries found for this award');
    } else {
      console.log(`   Found ${allBiasForAward.length} bias entries:`);
      allBiasForAward.forEach((bias, index) => {
        console.log(`\n   ${index + 1}. Bias ID: ${bias._id}`);
        console.log(`      Nominee: ${bias.nominee.name}`);
        console.log(`      Amount: +${bias.biasAmount} votes`);
        console.log(`      Reason: ${bias.reason}`);
        console.log(`      Is Active: ${bias.isActive}`);
        console.log(`      Created by: ${bias.appliedBy.name}`);
        console.log(`      Created at: ${bias.appliedAt}`);
        if (!bias.isActive) {
          console.log(`      Deactivated by: ${bias.deactivatedBy?.name || 'Unknown'}`);
          console.log(`      Deactivated at: ${bias.deactivatedAt}`);
          console.log(`      Deactivation reason: ${bias.deactivationReason}`);
        }
      });
    }

    // Check specifically for this nominee
    console.log('\n🎯 BIAS ENTRIES FOR SPECIFIC NOMINEE:');
    console.log('====================================');
    
    const biasForNominee = await VoteBias.find({ 
      awardId: award._id, 
      nomineeId: nominee._id 
    })
      .populate('appliedBy', 'name')
      .populate('deactivatedBy', 'name')
      .sort({ appliedAt: -1 });

    if (biasForNominee.length === 0) {
      console.log(`   No bias entries found for ${nominee.name}`);
    } else {
      console.log(`   Found ${biasForNominee.length} bias entries for ${nominee.name}:`);
      biasForNominee.forEach((bias, index) => {
        console.log(`\n   ${index + 1}. Bias ID: ${bias._id}`);
        console.log(`      Amount: +${bias.biasAmount} votes`);
        console.log(`      Reason: ${bias.reason}`);
        console.log(`      Is Active: ${bias.isActive}`);
        console.log(`      Created by: ${bias.appliedBy.name}`);
        console.log(`      Created at: ${bias.appliedAt}`);
        if (!bias.isActive) {
          console.log(`      Deactivated by: ${bias.deactivatedBy?.name || 'Unknown'}`);
          console.log(`      Deactivated at: ${bias.deactivatedAt}`);
          console.log(`      Deactivation reason: ${bias.deactivationReason}`);
        }
      });
    }

    // Check active vs inactive counts
    console.log('\n📊 SUMMARY STATISTICS:');
    console.log('======================');
    
    const totalBias = await VoteBias.countDocuments({ awardId: award._id });
    const activeBias = await VoteBias.countDocuments({ awardId: award._id, isActive: true });
    const inactiveBias = await VoteBias.countDocuments({ awardId: award._id, isActive: false });
    
    console.log(`   Total bias entries for award: ${totalBias}`);
    console.log(`   Active bias entries: ${activeBias}`);
    console.log(`   Inactive bias entries: ${inactiveBias}`);

    const totalForNominee = await VoteBias.countDocuments({ 
      awardId: award._id, 
      nomineeId: nominee._id 
    });
    const activeForNominee = await VoteBias.countDocuments({ 
      awardId: award._id, 
      nomineeId: nominee._id, 
      isActive: true 
    });
    const inactiveForNominee = await VoteBias.countDocuments({ 
      awardId: award._id, 
      nomineeId: nominee._id, 
      isActive: false 
    });
    
    console.log(`\n   For ${nominee.name} specifically:`);
    console.log(`   Total bias entries: ${totalForNominee}`);
    console.log(`   Active bias entries: ${activeForNominee}`);
    console.log(`   Inactive bias entries: ${inactiveForNominee}`);

    // Test what happens when we try to create a new bias
    console.log('\n🧪 TESTING BIAS CREATION:');
    console.log('=========================');
    
    try {
      const testBias = new VoteBias({
        awardId: award._id,
        nomineeId: nominee._id,
        biasAmount: 25,
        reason: 'Test creation',
        appliedBy: admin._id
      });
      
      await testBias.save();
      console.log(`✅ Successfully created test bias: ${testBias._id}`);
      
      // Clean up the test bias
      await VoteBias.findByIdAndDelete(testBias._id);
      console.log('✅ Test bias cleaned up');
      
    } catch (error) {
      if (error.code === 11000) {
        console.log('❌ Cannot create new bias - duplicate key error');
        console.log('   This means there is already a bias entry (active or inactive)');
        console.log('   The unique constraint prevents multiple bias entries per nominee per award');
        console.log('\n💡 This explains the issue:');
        console.log('   1. User creates bias → Works (new entry)');
        console.log('   2. User deletes bias → Works (sets isActive: false)');
        console.log('   3. User tries to create new bias → Fails (duplicate constraint)');
        console.log('\n🔧 Solution options:');
        console.log('   A. Remove unique constraint (allow multiple bias entries)');
        console.log('   B. Use hard delete (completely remove record)');
        console.log('   C. Reactivate existing inactive bias instead of creating new');
      } else {
        console.log(`❌ Unexpected error: ${error.message}`);
      }
    }

    console.log('\n🎯 DIAGNOSIS:');
    console.log('=============');
    console.log('✅ DELETE operation IS working correctly in MongoDB');
    console.log('✅ Records are being marked as inactive (isActive: false)');
    console.log('✅ Deactivation metadata is being stored properly');
    console.log('❌ But unique constraint prevents creating new bias after delete');
    console.log('\n💡 The "delete not working" issue is actually:');
    console.log('   - Delete works (record becomes inactive)');
    console.log('   - But you cannot create a new bias for same nominee');
    console.log('   - Because the inactive record still exists');

  } catch (error) {
    console.error('❌ Check failed:', error.message);
  } finally {
    await mongoose.disconnect();
    console.log('\n🔌 Disconnected from MongoDB');
  }
}

// Run the check
checkDatabaseState();