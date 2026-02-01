const mongoose = require('mongoose');
const Member = require('../src/models/Member');
require('dotenv').config();

async function debugMemberProfilePictures() {
  try {
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('Connected to MongoDB');
    
    // Get all members
    const members = await Member.find({}).select('firstName lastName profilePicture registrationNumber createdAt');
    
    console.log(`\n=== MEMBER PROFILE PICTURE DEBUG ===`);
    console.log(`Found ${members.length} members in database\n`);
    
    let membersWithPictures = 0;
    let membersWithoutPictures = 0;
    let membersWithEmptyUrls = 0;
    let membersWithNullPictures = 0;
    
    members.forEach((member, index) => {
      console.log(`${index + 1}. ${member.firstName} ${member.lastName} (${member.registrationNumber})`);
      
      if (!member.profilePicture) {
        console.log(`   ❌ Profile Picture: null/undefined`);
        membersWithNullPictures++;
      } else {
        console.log(`   📷 Profile Picture Object:`, {
          url: member.profilePicture.url,
          key: member.profilePicture.key,
          uploadedAt: member.profilePicture.uploadedAt
        });
        
        if (member.profilePicture.url && member.profilePicture.url.trim() !== '') {
          console.log(`   ✅ Has valid profile picture URL`);
          membersWithPictures++;
        } else {
          console.log(`   ❌ Profile picture URL is empty or null`);
          membersWithEmptyUrls++;
        }
      }
      
      console.log(`   📅 Registered: ${member.createdAt.toLocaleDateString()}`);
      console.log('');
    });
    
    console.log(`=== SUMMARY ===`);
    console.log(`Total members: ${members.length}`);
    console.log(`Members with valid profile pictures: ${membersWithPictures}`);
    console.log(`Members with empty/null URLs: ${membersWithEmptyUrls}`);
    console.log(`Members with null profile picture objects: ${membersWithNullPictures}`);
    console.log(`Members without pictures: ${membersWithoutPictures}`);
    
    // Check if there are any members with profile pictures
    if (membersWithPictures === 0) {
      console.log(`\n⚠️  NO MEMBERS HAVE PROFILE PICTURES!`);
      console.log(`This explains why initials are showing instead of profile pictures.`);
      console.log(`\nPossible causes:`);
      console.log(`1. Members were registered without uploading profile pictures`);
      console.log(`2. Profile picture uploads are failing during registration`);
      console.log(`3. Profile picture URLs are not being saved correctly`);
      console.log(`4. S3 upload configuration issues`);
    }
    
    // Show a sample member with profile picture if any exist
    const memberWithPicture = members.find(m => m.profilePicture?.url && m.profilePicture.url.trim() !== '');
    if (memberWithPicture) {
      console.log(`\n📸 Sample member with profile picture:`);
      console.log(`Name: ${memberWithPicture.firstName} ${memberWithPicture.lastName}`);
      console.log(`URL: ${memberWithPicture.profilePicture.url}`);
      console.log(`Key: ${memberWithPicture.profilePicture.key}`);
    }
    
  } catch (error) {
    console.error('Error debugging member profile pictures:', error);
  } finally {
    await mongoose.disconnect();
    console.log('\nDisconnected from MongoDB');
  }
}

debugMemberProfilePictures();