const mongoose = require('mongoose');
const { Award } = require('../src/models');
const VoteBias = require('../src/models/VoteBias');
const voteService = require('../src/services/voteService');

async function checkCurrentBias() {
  try {
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/biometric-voting');
    console.log('Connected to MongoDB');

    const award = await Award.findOne({ title: /Best Perorming Senetor/ });
    console.log(`\nChecking bias for award: ${award.title} (${award._id})`);

    // Check current active bias entries
    const activeBias = await VoteBias.find({ awardId: award._id, isActive: true })
      .populate('nominee', 'name');
    
    console.log(`\nActive bias entries: ${activeBias.length}`);
    activeBias.forEach(bias => {
      console.log(`- ${bias.nominee?.name}: +${bias.biasAmount} votes (ID: ${bias._id})`);
    });

    // Test vote service directly
    console.log('\n=== Vote Service Test ===');
    const voteCounts = await voteService.getVoteCountsForAward(award._id.toString());
    console.log('Vote counts from service:');
    voteCounts.forEach(count => {
      console.log(`- ${count.nomineeName}: ${count.count} votes (Original: ${count.originalCount}, Bias: ${count.biasAmount})`);
    });

  } catch (error) {
    console.error('Error:', error);
  } finally {
    await mongoose.disconnect();
  }
}

checkCurrentBias();