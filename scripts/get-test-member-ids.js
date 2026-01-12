#!/usr/bin/env node

/**
 * Get member IDs for testing admin routes
 */

require('dotenv').config();
const mongoose = require('mongoose');
const Member = require('../src/models/Member');

async function getTestMemberIds() {
  try {
    console.log('🔗 Connecting to MongoDB...');
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB');

    const members = await Member.find({}).limit(5);
    
    console.log('\n🧪 READY-TO-TEST ADMIN MEMBER URLS:');
    console.log('==================================');
    
    members.forEach((member, index) => {
      console.log(`\n${index + 1}. ${member.fullName} (${member.registrationNumber})`);
      console.log(`   View: http://localhost:3000/admin/members/${member._id}`);
      console.log(`   Edit: http://localhost:3000/admin/members/${member._id}/edit`);
      
      if (member.profilePicture?.url && member.profilePicture.url.trim() !== '') {
        console.log(`   📸 Has profile picture: ${member.profilePicture.url}`);
      } else {
        console.log(`   👤 Shows initials: ${member.firstName.charAt(0)}${member.lastName.charAt(0)}`);
      }
    });

    console.log('\n🎯 Quick Test Instructions:');
    console.log('1. Copy any URL above');
    console.log('2. Login as System_Admin');
    console.log('3. Paste URL in browser');
    console.log('4. Verify the page loads correctly');
    console.log('5. Test button functionality');

  } catch (error) {
    console.error('❌ Failed:', error.message);
  } finally {
    await mongoose.disconnect();
    console.log('\n🔌 Disconnected from MongoDB');
  }
}

getTestMemberIds();