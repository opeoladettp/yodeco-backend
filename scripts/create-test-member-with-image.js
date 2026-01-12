#!/usr/bin/env node

/**
 * Create a test member with a working profile picture URL
 */

require('dotenv').config();
const mongoose = require('mongoose');
const Member = require('../src/models/Member');

async function createTestMemberWithImage() {
  try {
    console.log('🔗 Connecting to MongoDB...');
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB');

    // Clean up existing test member
    await Member.deleteMany({ email: 'test.working.image@example.com' });

    // Create member with a working image URL (using a reliable placeholder service)
    const testMember = new Member({
      firstName: 'Test',
      lastName: 'User',
      otherNames: 'Working Image',
      email: 'test.working.image@example.com',
      phoneNumber: '+2348012345999',
      dateOfBirth: new Date('1990-01-01'),
      profilePicture: {
        url: 'https://picsum.photos/150/150?random=1',
        key: 'members/profiles/test-working-image.jpg',
        uploadedAt: new Date()
      },
      metadata: {
        ipAddress: '127.0.0.1',
        userAgent: 'Test Script',
        registrationSource: 'web'
      }
    });

    await testMember.save();

    console.log('\n✅ Created test member with working image:');
    console.log(`Name: ${testMember.fullName}`);
    console.log(`Registration: ${testMember.registrationNumber}`);
    console.log(`ID: ${testMember._id}`);
    console.log(`Profile Picture URL: ${testMember.profilePicture.url}`);

    console.log('\n🌐 Test URLs:');
    console.log(`Profile Page: http://localhost:3000/member/profile/${testMember._id}`);
    console.log(`Admin Members: http://localhost:3000/admin/members`);
    console.log(`Direct Image: ${testMember.profilePicture.url}`);

    console.log('\n🔍 Expected Behavior:');
    console.log('• Profile page should show the actual image');
    console.log('• Admin members page should show the image in the member card');
    console.log('• If image fails to load, should show "TU" initials');

    // Also update Alice's image to use a more reliable service
    const alice = await Member.findOne({ email: 'test.with.picture@example.com' });
    if (alice) {
      alice.profilePicture.url = 'https://picsum.photos/150/150?random=2';
      await alice.save();
      console.log('\n✅ Updated Alice Johnson with reliable image URL');
      console.log(`Alice Profile: http://localhost:3000/member/profile/${alice._id}`);
      console.log(`Alice Image: ${alice.profilePicture.url}`);
    }

  } catch (error) {
    console.error('❌ Test failed:', error.message);
  } finally {
    await mongoose.disconnect();
    console.log('\n🔌 Disconnected from MongoDB');
  }
}

createTestMemberWithImage();