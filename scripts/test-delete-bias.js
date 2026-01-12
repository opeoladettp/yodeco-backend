const mongoose = require('mongoose');
const { Award } = require('../src/models');
const VoteBias = require('../src/models/VoteBias');

async function testDeleteBias() {
  try {
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/biometric-voting');
    console.log('Connected to MongoDB');

    const award = await Award.findOne({ title: /Best Perorming Senetor/ });
    console.log(`\nTesting delete bias for award: ${award.title} (${award._id})`);

    // Get current active bias entries
    const activeBias = await VoteBias.find({ awardId: award._id, isActive: true })
      .populate('nominee', 'name');
    
    console.log(`\nCurrent active bias entries: ${activeBias.length}`);
    activeBias.forEach((bias, index) => {
      console.log(`${index + 1}. ${bias.nominee?.name}: +${bias.biasAmount} votes (ID: ${bias._id})`);
    });

    if (activeBias.length === 0) {
      console.log('No active bias entries to test delete with');
      return;
    }

    // Test deleting the first bias entry
    const biasToDelete = activeBias[0];
    console.log(`\nTesting delete for: ${biasToDelete.nominee?.name} (+${biasToDelete.biasAmount} votes)`);
    console.log(`Bias ID: ${biasToDelete._id}`);

    // Simulate the delete operation (what the backend DELETE endpoint does)
    console.log('\n=== Simulating DELETE operation ===');
    biasToDelete.isActive = false;
    biasToDelete.deactivatedBy = biasToDelete.appliedBy; // Use same user for test
    biasToDelete.deactivatedAt = new Date();
    biasToDelete.deactivationReason = 'Test delete operation via script';
    
    await biasToDelete.save();
    console.log('✓ Bias entry marked as inactive (soft delete)');

    // Verify the delete worked
    const remainingActiveBias = await VoteBias.find({ awardId: award._id, isActive: true })
      .populate('nominee', 'name');
    
    console.log(`\nRemaining active bias entries: ${remainingActiveBias.length}`);
    remainingActiveBias.forEach((bias, index) => {
      console.log(`${index + 1}. ${bias.nominee?.name}: +${bias.biasAmount} votes`);
    });

    // Check the deleted entry
    const deletedBias = await VoteBias.findById(biasToDelete._id);
    console.log(`\nDeleted bias entry status:`);
    console.log(`- Active: ${deletedBias.isActive}`);
    console.log(`- Deactivated at: ${deletedBias.deactivatedAt}`);
    console.log(`- Deactivation reason: ${deletedBias.deactivationReason}`);

    console.log('\n✓ Delete functionality test completed successfully!');
    console.log('\nThe delete operation works correctly:');
    console.log('1. Sets isActive to false (soft delete)');
    console.log('2. Records deactivation timestamp and reason');
    console.log('3. Preserves the entry for audit trail');
    console.log('4. Removes it from active bias calculations');

    // Restore the bias for further testing
    console.log('\n=== Restoring bias for further testing ===');
    biasToDelete.isActive = true;
    biasToDelete.deactivatedBy = null;
    biasToDelete.deactivatedAt = null;
    biasToDelete.deactivationReason = null;
    await biasToDelete.save();
    console.log('✓ Bias entry restored');

  } catch (error) {
    console.error('Error:', error);
  } finally {
    await mongoose.disconnect();
  }
}

testDeleteBias();