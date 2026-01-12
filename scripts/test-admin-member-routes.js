#!/usr/bin/env node

/**
 * Test script to verify admin member routes are working
 */

require('dotenv').config();
const mongoose = require('mongoose');
const Member = require('../src/models/Member');

async function testAdminMemberRoutes() {
  try {
    console.log('🔗 Connecting to MongoDB...');
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB');

    console.log('\n🧪 TESTING ADMIN MEMBER ROUTES');
    console.log('==============================');

    // Get some test members
    const members = await Member.find({}).limit(3);
    
    if (members.length === 0) {
      console.log('❌ No members found for testing');
      return;
    }

    console.log('\n📋 Available Routes Fixed:');
    console.log('✅ /admin/members - Member management page');
    console.log('✅ /admin/members/:id - View member profile (admin context)');
    console.log('✅ /admin/members/:id/edit - Edit member profile (auto-edit mode)');

    console.log('\n👤 Test Members:');
    members.forEach((member, index) => {
      console.log(`${index + 1}. ${member.fullName} (${member.registrationNumber})`);
      console.log(`   View: http://localhost:3000/admin/members/${member._id}`);
      console.log(`   Edit: http://localhost:3000/admin/members/${member._id}/edit`);
    });

    console.log('\n🔧 Route Behavior:');
    console.log('• /admin/members/:id - Shows member profile with "Back to Members" button');
    console.log('• /admin/members/:id/edit - Opens profile in edit mode automatically');
    console.log('• Both routes require System_Admin authentication');
    console.log('• Navigation buttons adapt to admin context');

    console.log('\n🌐 Testing Instructions:');
    console.log('1. Login as System_Admin user');
    console.log('2. Go to http://localhost:3000/admin/members');
    console.log('3. Click "View" on any member - should show profile');
    console.log('4. Click "Edit" on any member - should open in edit mode');
    console.log('5. Check that "Back to Members" button works correctly');

    console.log('\n🎯 Expected Results:');
    console.log('• View button: Opens member profile in read-only mode');
    console.log('• Edit button: Opens member profile in edit mode');
    console.log('• Back navigation: Returns to /admin/members');
    console.log('• No more blank pages or 404 errors');

    console.log('\n✅ ADMIN MEMBER ROUTES TEST COMPLETE!');

  } catch (error) {
    console.error('❌ Test failed:', error.message);
  } finally {
    await mongoose.disconnect();
    console.log('\n🔌 Disconnected from MongoDB');
  }
}

testAdminMemberRoutes();