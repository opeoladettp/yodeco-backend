require('dotenv').config();
const mongoose = require('mongoose');
const VoteBias = require('../src/models/VoteBias');
const Vote = require('../src/models/Vote');

async function checkBiasData() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('Connected to MongoDB');

    // Get all bias entries
    const allBias = await VoteBias.find({});
    console.log('\n=== All Vote Bias Entries ===');
    console.log(`Total entries: ${allBias.length}`);
    
    allBias.forEach((bias, index) => {
      console.log(`\n--- Bias Entry ${index + 1} ---`);
      console.log('ID:', bias._id.toString());
      console.log('Award ID:', bias.awardId?.toString());
      console.log('Nominee ID:', bias.nomineeId?.toString());
      console.log('Bias Amount:', bias.biasAmount);
      console.log('Is Active:', bias.isActive);
      console.log('Reason:', bias.reason);
    });

    // Get all votes
    const allVotes = await Vote.find({});
    console.log('\n\n=== All Votes ===');
    console.log(`Total votes: ${allVotes.length}`);
    
    const votesByAward = {};
    allVotes.forEach(vote => {
      const awardId = vote.awardId?.toString();
      if (!votesByAward[awardId]) {
        votesByAward[awardId] = [];
      }
      votesByAward[awardId].push(vote);
    });

    Object.entries(votesByAward).forEach(([awardId, votes]) => {
      console.log(`\nAward ${awardId}: ${votes.length} votes`);
      const nomineeVotes = {};
      votes.forEach(vote => {
        const nomineeId = vote.nomineeId?.toString();
        nomineeVotes[nomineeId] = (nomineeVotes[nomineeId] || 0) + 1;
      });
      Object.entries(nomineeVotes).forEach(([nomineeId, count]) => {
        console.log(`  Nominee ${nomineeId}: ${count} votes`);
      });
    });

    await mongoose.connection.close();
    console.log('\n✅ Check completed');
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

checkBiasData();
