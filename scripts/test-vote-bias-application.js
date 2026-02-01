require('dotenv').config();
const mongoose = require('mongoose');
const Vote = require('../src/models/Vote');
const VoteBias = require('../src/models/VoteBias');

async function testVoteBiasApplication() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('Connected to MongoDB');

    // Get the award ID from the bias entry
    const awardId = '69666d3a766df5560e534ad8';
    const nomineeId = '696676ca6f5a32f70258808f';

    console.log('\n=== Testing Vote Bias Application ===');
    console.log('Award ID:', awardId);
    console.log('Nominee ID:', nomineeId);

    // Get actual votes
    const voteCounts = await Vote.getVoteCountsForAward(awardId);
    console.log('\n--- Actual Vote Counts ---');
    console.log(JSON.stringify(voteCounts, null, 2));

    // Get bias entries
    const biasEntries = await VoteBias.getActiveBiasForAward(awardId);
    console.log('\n--- Active Bias Entries ---');
    console.log(JSON.stringify(biasEntries, null, 2));

    // Manually apply bias to see what should happen
    console.log('\n--- Applying Bias Manually ---');
    const countsMap = new Map();
    
    // Initialize with vote counts
    voteCounts.forEach(count => {
      countsMap.set(count.nomineeId, {
        nomineeId: count.nomineeId,
        nomineeName: count.nomineeName,
        count: count.count,
        biasAmount: 0,
        hasBias: false
      });
    });

    // Apply bias
    biasEntries.forEach(bias => {
      const nId = bias.nomineeId.toString();
      console.log(`\nProcessing bias for nominee ${nId}:`);
      console.log(`  Bias Amount: ${bias.biasAmount}`);
      
      if (countsMap.has(nId)) {
        const existing = countsMap.get(nId);
        console.log(`  Original Count: ${existing.count}`);
        existing.count += bias.biasAmount;
        console.log(`  New Count (with bias): ${existing.count}`);
        existing.biasAmount = bias.biasAmount;
        existing.hasBias = true;
        existing.biasReason = bias.reason;
      } else {
        console.log(`  Nominee not in vote counts, creating new entry`);
        countsMap.set(nId, {
          nomineeId: nId,
          nomineeName: bias.nominee?.name || 'Unknown',
          count: bias.biasAmount,
          biasAmount: bias.biasAmount,
          hasBias: true,
          biasReason: bias.reason
        });
      }
    });

    console.log('\n--- Final Counts (with bias applied) ---');
    const finalCounts = Array.from(countsMap.values()).sort((a, b) => b.count - a.count);
    finalCounts.forEach(entry => {
      console.log(`${entry.nomineeName}: ${entry.count} votes (bias: ${entry.biasAmount})`);
    });

    await mongoose.connection.close();
    console.log('\n✅ Test completed');
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  }
}

testVoteBiasApplication();
