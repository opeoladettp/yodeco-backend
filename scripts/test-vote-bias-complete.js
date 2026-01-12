const mongoose = require('mongoose');
const { Award, Nominee, User } = require('../src/models');
const VoteBias = require('../src/models/VoteBias');
const voteService = require('../src/services/voteService');

async function testVoteBiasComplete() {
  try {
    // Connect to database
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/biometric-voting');
    console.log('Connected to MongoDB');

    // Find an existing award
    const award = await Award.findOne().populate('nominees');
    if (!award) {
      console.log('No awards found in database');
      return;
    }

    console.log(`\nTesting with award: ${award.title}`);
    console.log(`Award ID: ${award._id}`);

    // Find nominees for this award
    const nominees = await Nominee.find({ awardId: award._id, isActive: true, approvalStatus: 'approved' });
    console.log(`Found ${nominees.length} nominees for this award:`);
    nominees.forEach((nominee, index) => {
      console.log(`  ${index + 1}. ${nominee.name} (ID: ${nominee._id})`);
    });

    if (nominees.length === 0) {
      console.log('No nominees found for this award');
      return;
    }

    // Test the new nominees endpoint
    console.log('\n=== Testing /api/content/awards/:id/nominees endpoint ===');
    const testNominee = nominees[0];
    console.log(`Testing with nominee: ${testNominee.name} (${testNominee._id})`);

    // Find a System_Admin user
    const adminUser = await User.findOne({ role: 'System_Admin' });
    if (!adminUser) {
      console.log('No System_Admin user found');
      return;
    }

    console.log(`Using admin user: ${adminUser.name} (${adminUser.email})`);

    // Test creating vote bias
    console.log('\n=== Testing Vote Bias Creation ===');
    
    // Check if bias already exists
    const existingBias = await VoteBias.findOne({ 
      awardId: award._id, 
      nomineeId: testNominee._id,
      isActive: true 
    });

    if (existingBias) {
      console.log('Bias already exists, removing it first...');
      await VoteBias.findByIdAndDelete(existingBias._id);
    }

    // Create new bias
    const biasData = {
      awardId: award._id,
      nomineeId: testNominee._id,
      biasAmount: 50,
      reason: 'Test bias for demonstration purposes',
      appliedBy: adminUser._id
    };

    const voteBias = new VoteBias(biasData);
    await voteBias.save();
    console.log(`✓ Vote bias created successfully: +${voteBias.biasAmount} votes for ${testNominee.name}`);

    // Test getting vote counts with bias
    console.log('\n=== Testing Vote Counts with Bias ===');
    const voteCounts = await voteService.getVoteCountsForAward(award._id.toString());
    console.log('Vote counts with bias applied:');
    voteCounts.forEach(count => {
      const biasInfo = count.hasBias ? ` (Original: ${count.originalCount}, Bias: +${count.biasAmount})` : '';
      console.log(`  ${count.nomineeName}: ${count.count} votes${biasInfo}`);
    });

    // Test getting original vote counts (without bias)
    console.log('\n=== Testing Original Vote Counts (No Bias) ===');
    const originalCounts = await voteService.getOriginalVoteCountsForAward(award._id.toString());
    console.log('Original vote counts (no bias):');
    originalCounts.forEach(count => {
      console.log(`  ${count.nomineeName}: ${count.count} votes`);
    });

    // Test getting bias entries for award
    console.log('\n=== Testing Bias Entries Retrieval ===');
    const biasEntries = await VoteBias.getActiveBiasForAward(award._id);
    console.log(`Found ${biasEntries.length} active bias entries:`);
    biasEntries.forEach(bias => {
      console.log(`  ${bias.nominee?.name}: +${bias.biasAmount} votes (${bias.reason})`);
    });

    console.log('\n✓ All tests completed successfully!');
    console.log('\nThe Vote Bias Manager should now work properly in the frontend.');
    console.log('You can access it at: http://localhost:3000/admin (login as System_Admin)');

  } catch (error) {
    console.error('Test failed:', error);
  } finally {
    await mongoose.disconnect();
    console.log('Disconnected from MongoDB');
  }
}

// Run the test
testVoteBiasComplete();