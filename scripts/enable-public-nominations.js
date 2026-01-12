const mongoose = require('mongoose');
require('dotenv').config();

// Connect to MongoDB
mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/biometric-voting');

const Award = require('../src/models/Award');

async function enablePublicNominations() {
  try {
    console.log('Updating awards to enable public nominations...');
    
    // Update all existing awards to allow public nominations
    const result = await Award.updateMany(
      {}, // All awards
      {
        $set: {
          allowPublicNomination: true,
          nominationStartDate: new Date('2026-01-01'),
          nominationEndDate: new Date('2026-12-31')
        }
      }
    );
    
    console.log(`Updated ${result.modifiedCount} awards`);
    
    // Show updated awards
    const awards = await Award.find({}).select('title allowPublicNomination nominationStartDate nominationEndDate');
    console.log('\nUpdated awards:');
    awards.forEach(award => {
      console.log(`- ${award.title}: allowPublicNomination = ${award.allowPublicNomination}`);
    });
    
    process.exit(0);
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

enablePublicNominations();