const mongoose = require('mongoose');
require('dotenv').config();

// Import models
const VoteBias = require('../src/models/VoteBias');
const Award = require('../src/models/Award');
const Nominee = require('../src/models/Nominee');
const User = require('../src/models/User');
const voteService = require('../src/services/voteService');

async function testVoteBias() {
  try {
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/biometric-voting');
    console.log('Connected to MongoDB');

    // Find an admin user
    const adminUser = await User.findOne({ role: 'System_Admin' });
    if (!adminUser) {
      console.log('No admin user found. Creating one...');
      const newAdmin = new User({
        name: 'Test Admin',
        email: 'admin@test.com',
        role: 'System_Admin'
      });
      await newAdmin.save();
      console.log('Admin user created');
    }

    // Find an active award with nominees
    const award = await Award.findOne({ isActive: true });
    if (!award) {
      console.log('No active awards found');
      return;
    }

    const nominees = await Nominee.find({ awardId: award._id });
    if (nominees.length === 0) {
      console.log('No nominees found for the award');
      return;
    }

    console.log(`\nTesting vote bias for award: ${award.title}`);
    console.log(`Found ${nominees.length} nominees`);

    // Get original vote counts
    console.log('\n--- Original Vote Counts ---');
    const originalCounts = await voteService.getOriginalVoteCountsForAward(award._id.toString());
    originalCounts.forEach(count => {
      console.log(`${count.nomineeName}: ${count.count} votes`);
    });

    // Get current counts (with any existing bias)
    console.log('\n--- Current Vote Counts (with bias) ---');
    const currentCounts = await voteService.getVoteCountsForAward(award._id.toString());
    currentCounts.forEach(count => {
      console.log(`${count.nomineeName}: ${count.count} votes${count.hasBias ? ` (includes +${count.biasAmount} bias)` : ''}`);
    });

    // Add bias to the first nominee
    const targetNominee = nominees[0];
    const biasAmount = 50;

    console.log(`\n--- Adding ${biasAmount} vote bias to ${targetNominee.name} ---`);

    // Check if bias already exists
    const existingBias = await VoteBias.findOne({ 
      awardId: award._id, 
      nomineeId: targetNominee._id, 
      isActive: true 
    });

    if (existingBias) {
      console.log('Bias already exists, updating...');
      existingBias.biasAmount = biasAmount;
      existingBias.reason = 'Updated test bias for demonstration';
      existingBias.appliedBy = adminUser._id;
      existingBias.appliedAt = new Date();
      await existingBias.save();
    } else {
      console.log('Creating new bias entry...');
      const newBias = new VoteBias({
        awardId: award._id,
        nomineeId: targetNominee._id,
        biasAmount: biasAmount,
        reason: 'Test bias for demonstration purposes',
        appliedBy: adminUser._id,
        metadata: {
          ipAddress: '127.0.0.1',
          userAgent: 'Test Script'
        }
      });
      await newBias.save();
    }

    // Get updated counts with bias
    console.log('\n--- Updated Vote Counts (with new bias) ---');
    const updatedCounts = await voteService.getVoteCountsForAward(award._id.toString());
    updatedCounts.forEach(count => {
      console.log(`${count.nomineeName}: ${count.count} votes${count.hasBias ? ` (includes +${count.biasAmount} bias)` : ''}`);
    });

    // Show bias entries for this award
    console.log('\n--- Active Bias Entries ---');
    const biasEntries = await VoteBias.getActiveBiasForAward(award._id);
    biasEntries.forEach(bias => {
      console.log(`${bias.nominee.name}: +${bias.biasAmount} votes - ${bias.reason}`);
      console.log(`  Applied by: ${bias.appliedBy.name} on ${bias.appliedAt.toLocaleDateString()}`);
    });

    console.log('\n✅ Vote bias test completed successfully!');
    console.log('\nYou can now:');
    console.log('1. Visit the Admin Dashboard at http://localhost:3000/admin');
    console.log('2. Go to the "Vote Bias" tab');
    console.log('3. Manage vote bias for different awards and nominees');
    console.log('4. View the updated vote counts in the voting page');

  } catch (error) {
    console.error('Error testing vote bias:', error);
  } finally {
    await mongoose.disconnect();
    console.log('\nDisconnected from MongoDB');
  }
}

// Run the test
testVoteBias();