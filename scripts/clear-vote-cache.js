const mongoose = require('mongoose');
const { Award } = require('../src/models');
const voteService = require('../src/services/voteService');

async function clearVoteCache() {
  try {
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/biometric-voting');
    console.log('Connected to MongoDB');

    const award = await Award.findOne({ title: /Best Perorming Senetor/ });
    console.log(`\nClearing cache for award: ${award.title} (${award._id})`);

    // Clear the cache
    const success = await voteService.clearVoteCountsCache(award._id.toString());
    console.log(`Cache clear result: ${success ? 'Success' : 'Failed'}`);

    // Test the vote counts after cache clear
    console.log('\n=== Testing vote counts after cache clear ===');
    const voteCounts = await voteService.getVoteCountsForAward(award._id.toString());
    console.log('Vote counts (should be fresh from database):');
    voteCounts.forEach(count => {
      console.log(`- ${count.nomineeName}: ${count.count} votes (Original: ${count.originalCount}, Bias: ${count.biasAmount})`);
    });

  } catch (error) {
    console.error('Error:', error);
  } finally {
    await mongoose.disconnect();
  }
}

clearVoteCache();