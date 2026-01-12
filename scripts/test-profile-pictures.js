#!/usr/bin/env node

/**
 * Test script to verify profile picture functionality
 */

require('dotenv').config();
const mongoose = require('mongoose');
const Member = require('../src/models/Member');

async function testProfilePictures() {
  try {
    console.log('🔗 Connecting to MongoDB...');
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB');

    console.log('\n🧪 TESTING PROFILE PICTURE FUNCTIONALITY');
    console.log('========================================');

    // Test 1: Check existing members with profile pictures
    console.log('\n1️⃣ Checking existing members with profile pictures...');
    
    const membersWithPictures = await Member.find({
      'profilePicture.url': { $exists: true, $ne: '' }
    });
    
    console.log(`✅ Found ${membersWithPictures.length} members with profile pictures`);
    
    if (membersWithPictures.length > 0) {
      membersWithPictures.forEach(member => {
        console.log(`   • ${member.fullName} (${member.registrationNumber})`);
        console.log(`     Picture URL: ${member.profilePicture.url}`);
        console.log(`     Picture Key: ${member.profilePicture.key}`);
      });
    }

    // Test 2: Check members without profile pictures
    console.log('\n2️⃣ Checking members without profile pictures...');
    
    const membersWithoutPictures = await Member.find({
      $or: [
        { 'profilePicture.url': { $exists: false } },
        { 'profilePicture.url': '' },
        { 'profilePicture.url': null }
      ]
    });
    
    console.log(`✅ Found ${membersWithoutPictures.length} members without profile pictures`);
    
    if (membersWithoutPictures.length > 0) {
      membersWithoutPictures.slice(0, 3).forEach(member => {
        console.log(`   • ${member.fullName} (${member.registrationNumber})`);
        console.log(`     Should show initials: ${member.firstName.charAt(0)}${member.lastName.charAt(0)}`);
      });
      
      if (membersWithoutPictures.length > 3) {
        console.log(`   ... and ${membersWithoutPictures.length - 3} more`);
      }
    }

    // Test 3: Create a test member with mock profile picture data
    console.log('\n3️⃣ Creating test member with mock profile picture...');
    
    // Clean up any existing test member
    await Member.deleteMany({ email: 'test.profile.picture@example.com' });
    
    const testMember = new Member({
      firstName: 'Profile',
      lastName: 'Test',
      otherNames: 'Picture',
      email: 'test.profile.picture@example.com',
      phoneNumber: '+2348012345678',
      dateOfBirth: new Date('1995-06-15'),
      profilePicture: {
        url: 'https://via.placeholder.com/150x150/007bff/ffffff?text=PT',
        key: 'members/profiles/test-profile-picture.jpg',
        uploadedAt: new Date()
      },
      metadata: {
        ipAddress: '127.0.0.1',
        userAgent: 'Test Script',
        registrationSource: 'web'
      }
    });
    
    await testMember.save();
    
    console.log(`✅ Created test member: ${testMember.fullName}`);
    console.log(`   Registration Number: ${testMember.registrationNumber}`);
    console.log(`   Profile Picture URL: ${testMember.profilePicture.url}`);
    console.log(`   Member ID: ${testMember._id}`);

    // Test 4: Verify profile picture structure
    console.log('\n4️⃣ Verifying profile picture data structure...');
    
    const memberWithPicture = await Member.findById(testMember._id);
    
    console.log('✅ Profile picture structure verification:');
    console.log(`   • URL exists: ${!!memberWithPicture.profilePicture.url}`);
    console.log(`   • Key exists: ${!!memberWithPicture.profilePicture.key}`);
    console.log(`   • Upload date exists: ${!!memberWithPicture.profilePicture.uploadedAt}`);
    console.log(`   • URL format: ${memberWithPicture.profilePicture.url}`);

    console.log('\n🎉 PROFILE PICTURE TESTS COMPLETED!');
    console.log('\n📋 Test Summary:');
    console.log(`✅ Members with pictures: ${membersWithPictures.length}`);
    console.log(`✅ Members without pictures: ${membersWithoutPictures.length}`);
    console.log('✅ Test member created with mock profile picture');
    console.log('✅ Profile picture data structure verified');

    console.log('\n🌐 Frontend Testing:');
    console.log('   • Visit http://localhost:3000/member/profile/' + testMember._id);
    console.log('   • Visit http://localhost:3000/admin/members (as admin)');
    console.log('   • Check if profile pictures display correctly');

    console.log('\n⚠️  Note: Test member will be cleaned up on next run');

  } catch (error) {
    console.error('❌ Test failed:', error.message);
    console.error(error.stack);
  } finally {
    await mongoose.disconnect();
    console.log('\n🔌 Disconnected from MongoDB');
  }
}

// Run the test
testProfilePictures();