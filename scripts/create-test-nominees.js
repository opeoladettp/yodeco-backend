const mongoose = require('mongoose');
require('dotenv').config();

const Award = require('../src/models/Award');
const Nominee = require('../src/models/Nominee');
const User = require('../src/models/User');

async function createTestNominees() {
  try {
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/biometric-voting');
    console.log('Connected to MongoDB');

    // Find the award
    const award = await Award.findOne({ isActive: true });
    if (!award) {
      console.log('No active award found');
      return;
    }

    console.log(`Creating nominees for award: ${award.title}`);

    // Find or create a user to be the creator
    let creator = await User.findOne({ role: 'Panelist' });
    if (!creator) {
      creator = await User.findOne({ role: 'System_Admin' });
    }
    if (!creator) {
      console.log('No suitable user found to create nominees');
      return;
    }

    // Test nominees data
    const testNominees = [
      {
        name: 'Senator Ahmed Ibrahim',
        bio: 'A dedicated public servant with over 15 years of experience in legislative affairs. Known for his advocacy for education reform and infrastructure development in Kwara State.',
        awardId: award._id,
        createdBy: creator._id,
        nominatedBy: creator._id,
        approvalStatus: 'approved',
        approvedBy: creator._id,
        approvedAt: new Date()
      },
      {
        name: 'Senator Fatima Abdullahi',
        bio: 'Champion of women\'s rights and youth empowerment. Has successfully sponsored multiple bills for economic development and social welfare programs.',
        awardId: award._id,
        createdBy: creator._id,
        nominatedBy: creator._id,
        approvalStatus: 'approved',
        approvedBy: creator._id,
        approvedAt: new Date()
      },
      {
        name: 'Senator Mohammed Saliu',
        bio: 'Former governor and current senator with a strong track record in healthcare initiatives and agricultural development. Leading advocate for rural development.',
        awardId: award._id,
        createdBy: creator._id,
        nominatedBy: creator._id,
        approvalStatus: 'approved',
        approvedBy: creator._id,
        approvedAt: new Date()
      },
      {
        name: 'Senator Aisha Lawal',
        bio: 'Environmental advocate and policy expert. Known for her work on sustainable development and climate change initiatives in the northern region.',
        awardId: award._id,
        createdBy: creator._id,
        nominatedBy: creator._id,
        approvalStatus: 'approved',
        approvedBy: creator._id,
        approvedAt: new Date()
      }
    ];

    // Check if nominees already exist
    const existingNominees = await Nominee.find({ awardId: award._id });
    if (existingNominees.length > 0) {
      console.log(`Found ${existingNominees.length} existing nominees. Skipping creation.`);
      existingNominees.forEach(nominee => {
        console.log(`- ${nominee.name}`);
      });
      return;
    }

    // Create nominees
    const createdNominees = [];
    for (const nomineeData of testNominees) {
      const nominee = new Nominee(nomineeData);
      await nominee.save();
      createdNominees.push(nominee);
      console.log(`✓ Created nominee: ${nominee.name}`);
    }

    console.log(`\n✅ Successfully created ${createdNominees.length} test nominees!`);
    console.log('\nYou can now test the vote bias system with these nominees.');

  } catch (error) {
    console.error('Error creating test nominees:', error);
  } finally {
    await mongoose.disconnect();
    console.log('\nDisconnected from MongoDB');
  }
}

createTestNominees();