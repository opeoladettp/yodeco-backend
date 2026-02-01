const mongoose = require('mongoose');
const VoteBias = require('../src/models/VoteBias');
require('dotenv').config();

async function checkActiveBias() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('Connected to MongoDB\n');
    
    const biases = await VoteBias.find({ isActive: true })
      .populate('nominee', 'name')
      .populate('award', 'title')
      .sort({ appliedAt: -1 });
    
    console.log(`Found ${biases.length} active bias entries:\n`);
    
    biases.forEach((bias, index) => {
      console.log(`${index + 1}. Award: ${bias.award?.title || 'Unknown'}`);
      console.log(`   Nominee: ${bias.nominee?.name || 'Unknown'}`);
      console.log(`   Bias Amount: ${bias.biasAmount}`);
      console.log(`   Applied At: ${bias.appliedAt}`);
      console.log(`   Reason: ${bias.reason}`);
      console.log('');
    });
    
    await mongoose.disconnect();
    process.exit(0);
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

checkActiveBias();
