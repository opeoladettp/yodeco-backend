#!/usr/bin/env node

/**
 * Debug script to investigate profile picture issues
 */

require('dotenv').config();
const mongoose = require('mongoose');
const Member = require('../src/models/Member');

async function debugProfilePictures() {
  try {
    console.log('🔗 Connecting to MongoDB...');
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB');

    console.log('\n🔍 DEBUGGING PROFILE PICTURE ISSUES');
    console.log('===================================');

    // Get all members and check their profile picture data
    const allMembers = await Member.find({});
    
    console.log(`\n📊 Found ${allMembers.length} total members`);
    
    allMembers.forEach((member, index) => {
      console.log(`\n${index + 1}. ${member.fullName} (${member.registrationNumber})`);
      console.log(`   Email: ${member.email}`);
      console.log(`   Profile Picture Object:`, JSON.stringify(member.profilePicture, null, 2));
      
      if (member.profilePicture) {
        console.log(`   • URL exists: ${!!member.profilePicture.url}`);
        console.log(`   • URL value: "${member.profilePicture.url}"`);
        console.log(`   • Key exists: ${!!member.profilePicture.key}`);
        console.log(`   • Key value: "${member.profilePicture.key}"`);
        console.log(`   • Upload date: ${member.profilePicture.uploadedAt}`);
      } else {
        console.log(`   • Profile Picture: null/undefined`);
      }
      
      // Check what should be displayed
      if (member.profilePicture?.url && member.profilePicture.url.trim() !== '') {
        console.log(`   ✅ Should show: Profile image from ${member.profilePicture.url}`);
      } else {
        console.log(`   ⚠️  Should show: Initials ${member.firstName.charAt(0)}${member.lastName.charAt(0)}`);
      }
    });

    // Check the member model schema
    console.log('\n📋 Member Model Profile Picture Schema:');
    const memberSchema = Member.schema.paths.profilePicture;
    console.log('Schema type:', memberSchema.constructor.name);
    if (memberSchema.schema) {
      console.log('Nested schema paths:', Object.keys(memberSchema.schema.paths));
    }

    console.log('\n🔧 DIAGNOSIS COMPLETE');

  } catch (error) {
    console.error('❌ Debug failed:', error.message);
    console.error(error.stack);
  } finally {
    await mongoose.disconnect();
    console.log('\n🔌 Disconnected from MongoDB');
  }
}

// Run the debug
debugProfilePictures();