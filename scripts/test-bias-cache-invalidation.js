const mongoose = require('mongoose');
const voteService = require('../src/services/voteService');
const VoteBias = require('../src/models/VoteBias');
const Award = require('../src/models/Award');
require('dotenv').config();

async function testBiasCacheInvalidation() {
  try {
    console.log('🧪 Testing Vote Bias Cache Invalidation\n');
    
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB\n');

    // Get all active bias entries
    const biasEntries = await VoteBias.find({ isActive: true })
      .populate('award', 'title')
      .populate('nominee', 'name');
    
    console.log(`📊 Found ${biasEntries.length} active bias entries:\n`);
    
    for (const bias of biasEntries) {
      console.log(`  Award: ${bias.award?.title || 'Unknown'}`);
      console.log(`  Nominee: ${bias.nominee?.name || 'Unknown'}`);
      console.log(`  Bias Amount: ${bias.biasAmount}`);
      console.log(`  Award ID: ${bias.awardId}`);
      console.log('');
    }

    // Test cache clearing for each award
    console.log('🧹 Testing cache clearing for each award:\n');
    
    const uniqueAwardIds = [...new Set(biasEntries.map(b => b.awardId.toString()))];
    
    for (const awardId of uniqueAwardIds) {
      const award = await Award.findById(awardId);
      console.log(`\n📋 Award: ${award?.title || awardId}`);
      
      // Get vote counts BEFORE clearing cache
      console.log('  Getting vote counts (may be cached)...');
      const countsBefore = await voteService.getVoteCountsForAward(awardId);
      console.log(`  Vote counts: ${JSON.stringify(countsBefore, null, 2)}`);
      
      // Clear cache
      console.log('  Clearing cache...');
      const cleared = await voteService.clearVoteCountsCache(awardId);
      console.log(`  Cache cleared: ${cleared}`);
      
      // Get vote counts AFTER clearing cache (should fetch fresh from DB)
      console.log('  Getting fresh vote counts from database...');
      const countsAfter = await voteService.getVoteCountsForAward(awardId);
      console.log(`  Fresh vote counts: ${JSON.stringify(countsAfter, null, 2)}`);
      
      // Compare
      const beforeTotal = countsBefore.reduce((sum, c) => sum + c.count, 0);
      const afterTotal = countsAfter.reduce((sum, c) => sum + c.count, 0);
      
      console.log(`  Total votes before: ${beforeTotal}`);
      console.log(`  Total votes after: ${afterTotal}`);
      console.log(`  Match: ${beforeTotal === afterTotal ? '✅' : '❌'}`);
    }

    console.log('\n✅ Test completed successfully');
    
  } catch (error) {
    console.error('❌ Test failed:', error);
    console.error(error.stack);
  } finally {
    await mongoose.disconnect();
    console.log('\n👋 Disconnected from MongoDB');
    process.exit(0);
  }
}

testBiasCacheInvalidation();
