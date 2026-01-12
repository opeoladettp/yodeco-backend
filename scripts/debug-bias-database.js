const mongoose = require('mongoose');
const { Award } = require('../src/models');
const VoteBias = require('../src/models/VoteBias');

async function debugBiasDatabase() {
  try {
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/biometric-voting');
    console.log('Connected to MongoDB');

    const award = await Award.findOne({ title: /Best Perorming Senetor/ });
    console.log(`\nDebugging bias database for award: ${award.title} (${award._id})`);

    // Check ALL bias entries (active and inactive)
    const allBiasEntries = await VoteBias.find({ awardId: award._id })
      .populate('nominee', 'name')
      .sort({ createdAt: -1 });
    
    console.log(`\nFound ${allBiasEntries.length} total bias entries:`);
    allBiasEntries.forEach((bias, index) => {
      console.log(`${index + 1}. ${bias.nominee?.name || 'Unknown'}: +${bias.biasAmount} votes`);
      console.log(`   ID: ${bias._id}`);
      console.log(`   Active: ${bias.isActive}`);
      console.log(`   Created: ${bias.appliedAt}`);
      console.log(`   Reason: "${bias.reason}"`);
      console.log('');
    });

    // Check for duplicate nominees
    const nomineeIds = allBiasEntries.map(b => b.nomineeId.toString());
    const duplicates = nomineeIds.filter((id, index) => nomineeIds.indexOf(id) !== index);
    
    if (duplicates.length > 0) {
      console.log('⚠️  Found duplicate nominee IDs:', duplicates);
      
      // Show details of duplicates
      for (const duplicateId of [...new Set(duplicates)]) {
        const duplicateEntries = allBiasEntries.filter(b => b.nomineeId.toString() === duplicateId);
        console.log(`\nDuplicate entries for nominee ${duplicateId}:`);
        duplicateEntries.forEach((entry, i) => {
          console.log(`  ${i + 1}. Active: ${entry.isActive}, Amount: ${entry.biasAmount}, ID: ${entry._id}`);
        });
      }
    } else {
      console.log('✓ No duplicate nominee IDs found');
    }

    // Check active bias entries only
    const activeBiasEntries = await VoteBias.find({ awardId: award._id, isActive: true })
      .populate('nominee', 'name');
    
    console.log(`\nActive bias entries: ${activeBiasEntries.length}`);
    activeBiasEntries.forEach((bias, index) => {
      console.log(`${index + 1}. ${bias.nominee?.name}: +${bias.biasAmount} votes (ID: ${bias._id})`);
    });

    // Check the specific nominee that's causing the duplicate key error
    const problematicNomineeId = '6964702dfef6b44f8a5932ca'; // From the error log
    const problematicEntries = await VoteBias.find({ 
      awardId: award._id, 
      nomineeId: problematicNomineeId 
    }).populate('nominee', 'name');
    
    console.log(`\nEntries for problematic nominee (${problematicNomineeId}):`);
    problematicEntries.forEach((entry, i) => {
      console.log(`  ${i + 1}. Active: ${entry.isActive}, Amount: ${entry.biasAmount}, ID: ${entry._id}`);
      console.log(`     Nominee: ${entry.nominee?.name}`);
      console.log(`     Created: ${entry.appliedAt}`);
    });

  } catch (error) {
    console.error('Error:', error);
  } finally {
    await mongoose.disconnect();
  }
}

debugBiasDatabase();