const mongoose = require('mongoose');
const { Award, Nominee, User, Vote } = require('../src/models');
const VoteBias = require('../src/models/VoteBias');
const voteService = require('../src/services/voteService');

async function debugBiasIssues() {
  try {
    // Connect to database
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/biometric-voting');
    console.log('Connected to MongoDB');

    // Find the award we're testing with
    const award = await Award.findOne({ title: /Best Perorming Senetor/ });
    if (!award) {
      console.log('Test award not found');
      return;
    }

    console.log(`\n=== Debugging Bias Issues for Award: ${award.title} ===`);
    console.log(`Award ID: ${award._id}`);

    // Get nominees
    const nominees = await Nominee.find({ awardId: award._id, isActive: true, approvalStatus: 'approved' });
    console.log(`\nNominees (${nominees.length}):`);
    nominees.forEach((nominee, index) => {
      console.log(`  ${index + 1}. ${nominee.name} (ID: ${nominee._id})`);
    });

    // Check current bias entries
    console.log('\n=== Current Bias Entries ===');
    const biasEntries = await VoteBias.find({ awardId: award._id })
      .populate('nominee', 'name')
      .populate('appliedBy', 'name email');
    
    console.log(`Found ${biasEntries.length} bias entries (including inactive):`);
    biasEntries.forEach(bias => {
      console.log(`  - ${bias.nominee?.name || 'Unknown'}: +${bias.biasAmount} votes (Active: ${bias.isActive})`);
      console.log(`    ID: ${bias._id}, Reason: "${bias.reason}"`);
    });

    // Check active bias entries only
    const activeBiasEntries = await VoteBias.find({ awardId: award._id, isActive: true })
      .populate('nominee', 'name');
    console.log(`\nActive bias entries: ${activeBiasEntries.length}`);
    activeBiasEntries.forEach(bias => {
      console.log(`  - ${bias.nominee?.name}: +${bias.biasAmount} votes`);
    });

    // Check actual votes in the database
    console.log('\n=== Actual Votes in Database ===');
    const actualVotes = await Vote.find({ awardId: award._id })
      .populate('nominee', 'name')
      .populate('user', 'name email');
    console.log(`Found ${actualVotes.length} actual votes:`);
    actualVotes.forEach(vote => {
      console.log(`  - ${vote.nominee?.name || 'Unknown nominee'} by ${vote.user?.name || 'Unknown user'}`);
    });

    // Test vote counts with bias (what the frontend should see)
    console.log('\n=== Vote Counts with Bias (Frontend View) ===');
    try {
      const voteCountsWithBias = await voteService.getVoteCountsForAward(award._id.toString());
      console.log('Vote counts with bias applied:');
      if (voteCountsWithBias.length === 0) {
        console.log('  No vote counts returned (this might be the issue!)');
      } else {
        voteCountsWithBias.forEach(count => {
          const biasInfo = count.hasBias ? ` (Original: ${count.originalCount}, Bias: +${count.biasAmount})` : '';
          console.log(`  - ${count.nomineeName}: ${count.count} total votes${biasInfo}`);
        });
      }
    } catch (error) {
      console.error('Error getting vote counts with bias:', error.message);
    }

    // Test original vote counts (without bias)
    console.log('\n=== Original Vote Counts (No Bias) ===');
    try {
      const originalCounts = await voteService.getOriginalVoteCountsForAward(award._id.toString());
      console.log('Original vote counts (no bias):');
      if (originalCounts.length === 0) {
        console.log('  No original vote counts found');
      } else {
        originalCounts.forEach(count => {
          console.log(`  - ${count.nomineeName}: ${count.count} votes`);
        });
      }
    } catch (error) {
      console.error('Error getting original vote counts:', error.message);
    }

    // Test delete functionality
    console.log('\n=== Testing Delete Functionality ===');
    if (activeBiasEntries.length > 0) {
      const biasToTest = activeBiasEntries[0];
      console.log(`Testing delete for bias: ${biasToTest.nominee?.name} (+${biasToTest.biasAmount} votes)`);
      console.log(`Bias ID: ${biasToTest._id}`);
      
      // Simulate the delete operation (what the backend DELETE endpoint does)
      console.log('Simulating delete operation...');
      biasToTest.isActive = false;
      biasToTest.deactivatedAt = new Date();
      biasToTest.deactivationReason = 'Test delete operation';
      await biasToTest.save();
      
      console.log('✓ Bias marked as inactive (soft delete)');
      
      // Check if it's now filtered out
      const remainingActiveBias = await VoteBias.find({ awardId: award._id, isActive: true });
      console.log(`Remaining active bias entries: ${remainingActiveBias.length}`);
      
      // Restore it for further testing
      biasToTest.isActive = true;
      biasToTest.deactivatedAt = null;
      biasToTest.deactivationReason = null;
      await biasToTest.save();
      console.log('✓ Bias restored for further testing');
    } else {
      console.log('No active bias entries to test delete with');
    }

    // Test the API endpoints directly
    console.log('\n=== Testing API Endpoints ===');
    console.log('You can test these endpoints manually:');
    console.log(`1. GET /api/admin/vote-bias/award/${award._id} - Get bias entries`);
    console.log(`2. DELETE /api/admin/vote-bias/{biasId} - Delete bias entry`);
    console.log(`3. GET /api/content/awards/${award._id}/nominees - Get nominees`);
    
    // Check if the issue is in the frontend API calls
    console.log('\n=== Potential Issues to Check ===');
    console.log('1. DELETE Issue:');
    console.log('   - Check browser network tab for DELETE request status');
    console.log('   - Verify the biasId is being passed correctly');
    console.log('   - Check if fetchAwardData() is being called after delete');
    console.log('   - Ensure the backend DELETE endpoint is working');
    
    console.log('\n2. Vote Totals Issue:');
    console.log('   - Check if vote counts are being displayed in the UI');
    console.log('   - Verify the vote service is including bias in calculations');
    console.log('   - Check if the frontend is calling the right endpoint for vote counts');
    console.log('   - Ensure bias entries are being applied to vote totals');

    console.log('\n=== Debugging Complete ===');
    console.log('Check the browser console and network tab for more details.');

  } catch (error) {
    console.error('Debug failed:', error);
  } finally {
    await mongoose.disconnect();
    console.log('\nDisconnected from MongoDB');
  }
}

// Run the debug
debugBiasIssues();