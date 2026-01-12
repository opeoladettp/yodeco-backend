#!/usr/bin/env node

/**
 * Test a specific member with profile picture
 */

require('dotenv').config();
const mongoose = require('mongoose');
const Member = require('../src/models/Member');

async function testSpecificMember() {
  try {
    console.log('🔗 Connecting to MongoDB...');
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB');

    // Find Alice Johnson who should have a profile picture
    const alice = await Member.findOne({ email: 'test.with.picture@example.com' });
    
    if (alice) {
      console.log('\n👤 Alice Johnson Profile:');
      console.log(`Name: ${alice.fullName}`);
      console.log(`Registration: ${alice.registrationNumber}`);
      console.log(`ID: ${alice._id}`);
      console.log(`Profile Picture URL: "${alice.profilePicture.url}"`);
      console.log(`Profile Picture Key: "${alice.profilePicture.key}"`);
      
      console.log('\n🌐 Frontend Test URLs:');
      console.log(`Profile Page: http://localhost:3000/member/profile/${alice._id}`);
      console.log(`Direct Image: ${alice.profilePicture.url}`);
      
      console.log('\n🔍 Logic Check:');
      console.log(`profilePicture?.url exists: ${!!alice.profilePicture?.url}`);
      console.log(`profilePicture.url truthy: ${!!alice.profilePicture.url}`);
      console.log(`profilePicture.url length: ${alice.profilePicture.url.length}`);
      
      // Test the exact condition used in frontend
      const shouldShowImage = alice.profilePicture?.url && alice.profilePicture.url.trim() !== '';
      console.log(`Should show image: ${shouldShowImage}`);
      
    } else {
      console.log('❌ Alice Johnson not found');
    }

  } catch (error) {
    console.error('❌ Test failed:', error.message);
  } finally {
    await mongoose.disconnect();
    console.log('\n🔌 Disconnected from MongoDB');
  }
}

testSpecificMember();