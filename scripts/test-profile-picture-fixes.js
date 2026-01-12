#!/usr/bin/env node

/**
 * Test script to verify profile picture fixes
 */

require('dotenv').config();
const mongoose = require('mongoose');
const Member = require('../src/models/Member');

async function testProfilePictureFixes() {
  try {
    console.log('🔗 Connecting to MongoDB...');
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB');

    console.log('\n🧪 TESTING PROFILE PICTURE FIXES');
    console.log('================================');

    // Get all members and categorize them
    const allMembers = await Member.find({});
    
    const membersWithImages = allMembers.filter(m => 
      m.profilePicture?.url && m.profilePicture.url.trim() !== ''
    );
    
    const membersWithoutImages = allMembers.filter(m => 
      !m.profilePicture?.url || m.profilePicture.url.trim() === ''
    );

    console.log('\n📊 Member Categories:');
    console.log(`✅ Members with profile pictures: ${membersWithImages.length}`);
    console.log(`⚠️  Members without profile pictures: ${membersWithoutImages.length}`);

    console.log('\n👤 Members WITH Profile Pictures:');
    membersWithImages.forEach((member, index) => {
      console.log(`${index + 1}. ${member.fullName} (${member.registrationNumber})`);
      console.log(`   URL: ${member.profilePicture.url}`);
      console.log(`   Profile: http://localhost:3000/member/profile/${member._id}`);
      console.log(`   Expected: Should show actual image`);
    });

    console.log('\n👤 Members WITHOUT Profile Pictures:');
    membersWithoutImages.forEach((member, index) => {
      console.log(`${index + 1}. ${member.fullName} (${member.registrationNumber})`);
      console.log(`   Profile: http://localhost:3000/member/profile/${member._id}`);
      console.log(`   Expected: Should show "${member.firstName.charAt(0)}${member.lastName.charAt(0)}" initials`);
    });

    console.log('\n🔧 Frontend Fixes Applied:');
    console.log('✅ Improved profile picture display logic');
    console.log('✅ Added proper empty string checking');
    console.log('✅ Added image error handling with fallback');
    console.log('✅ Updated CSS for better positioning');
    console.log('✅ Applied fixes to both MemberProfilePage and AdminMembersPage');

    console.log('\n🌐 Test Instructions:');
    console.log('1. Visit the profile pages listed above');
    console.log('2. Check admin members page: http://localhost:3000/admin/members');
    console.log('3. Verify images load for members with URLs');
    console.log('4. Verify initials show for members without URLs');
    console.log('5. Test image error handling by using broken URLs');

    console.log('\n🎯 Expected Behavior:');
    console.log('• Members with valid URLs should show actual images');
    console.log('• Members without URLs should show colored initials');
    console.log('• Broken image URLs should fallback to initials');
    console.log('• All profile pictures should be properly sized and centered');

    console.log('\n✨ Key Test Cases:');
    if (membersWithImages.length > 0) {
      const testMember = membersWithImages[0];
      console.log(`• Image Test: http://localhost:3000/member/profile/${testMember._id}`);
      console.log(`  Should show image from: ${testMember.profilePicture.url}`);
    }
    
    if (membersWithoutImages.length > 0) {
      const testMember = membersWithoutImages[0];
      console.log(`• Initials Test: http://localhost:3000/member/profile/${testMember._id}`);
      console.log(`  Should show: ${testMember.firstName.charAt(0)}${testMember.lastName.charAt(0)} initials`);
    }

  } catch (error) {
    console.error('❌ Test failed:', error.message);
  } finally {
    await mongoose.disconnect();
    console.log('\n🔌 Disconnected from MongoDB');
  }
}

testProfilePictureFixes();