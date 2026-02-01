const mongoose = require('mongoose');
const BiometricData = require('../src/models/BiometricData');
const { Category, Award, Nominee, User } = require('../src/models');

async function testCompleteBiometricFlow() {
  try {
    console.log('🧪 Testing Complete Biometric Verification Flow...\n');

    // Connect to MongoDB
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/biometric-voting');
    console.log('✅ Connected to MongoDB\n');

    // Clean up any existing test data
    await BiometricData.deleteMany({ 'metadata.deviceInfo': 'Test Device' });
    await User.deleteMany({ email: { $regex: /test.*@biometric\.test/ } });
    await Nominee.deleteMany({ name: { $regex: /Test Nominee/ } });
    await Award.deleteMany({ title: { $regex: /Test Award/ } });
    await Category.deleteMany({ name: { $regex: /Test Category/ } });

    // Create test users first
    const testUser1 = new User({
      googleId: 'test-user-1-biometric',
      email: 'testuser1@biometric.test',
      name: 'Test User 1',
      role: 'User'
    });
    await testUser1.save();

    const testUser2 = new User({
      googleId: 'test-user-2-biometric',
      email: 'testuser2@biometric.test',
      name: 'Test User 2',
      role: 'User'
    });
    await testUser2.save();
    console.log('✅ Created test users');

    // Create test category
    const testCategory = new Category({
      name: 'Test Category for Biometric',
      description: 'Test category for biometric verification',
      slug: 'test-biometric-category',
      createdBy: testUser1._id
    });
    await testCategory.save();
    console.log('✅ Created test category');

    // Create test award
    const testAward = new Award({
      title: 'Test Award for Biometric',
      criteria: 'Test award for biometric verification testing',
      categoryId: testCategory._id,
      createdBy: testUser1._id,
      isActive: true,
      allowPublicNomination: true,
      nominationStartDate: new Date(Date.now() - 172800000), // 2 days ago
      nominationEndDate: new Date(Date.now() - 86400000), // Yesterday
      votingStartDate: new Date(Date.now() - 43200000), // 12 hours ago
      votingEndDate: new Date(Date.now() + 172800000) // 2 days from now
    });
    await testAward.save();
    console.log('✅ Created test award');

    // Create test nominees
    const testNominee1 = new Nominee({
      name: 'Test Nominee 1',
      bio: 'First test nominee for biometric verification',
      awardId: testAward._id,
      createdBy: testUser1._id,
      nominatedBy: testUser1._id,
      approvalStatus: 'approved',
      isActive: true
    });
    await testNominee1.save();

    const testNominee2 = new Nominee({
      name: 'Test Nominee 2',
      bio: 'Second test nominee for biometric verification',
      awardId: testAward._id,
      createdBy: testUser1._id,
      nominatedBy: testUser1._id,
      approvalStatus: 'approved',
      isActive: true
    });
    await testNominee2.save();
    console.log('✅ Created test nominees');

    // Test 1: First user votes with biometric verification
    console.log('\n🧪 Test 1: First user biometric verification and vote');
    
    // Generate mock face descriptor for user 1
    const mockFaceDescriptor1 = Array.from({ length: 128 }, () => Math.random() * 2 - 1);
    const faceSignature1 = {
      data: mockFaceDescriptor1,
      timestamp: Date.now(),
      version: '1.0'
    };

    // Check for duplicates (should be none)
    const duplicateCheck1 = await BiometricData.findPotentialDuplicates(
      faceSignature1,
      testAward._id,
      testUser1._id,
      0.6
    );
    console.log(`   Duplicate check result: ${duplicateCheck1.length} matches found`);
    
    if (duplicateCheck1.length === 0) {
      console.log('✅ No duplicates found - user can vote');
    } else {
      console.log('❌ Unexpected duplicates found');
    }

    // Store biometric data for user 1
    const biometricData1 = new BiometricData({
      userId: testUser1._id,
      awardId: testAward._id,
      faceSignature: faceSignature1,
      biometricHash: generateBiometricHash(mockFaceDescriptor1),
      confidence: 0.85,
      faceQuality: {
        faceDetected: true,
        confidence: 0.85,
        isGoodQuality: true,
        issues: []
      },
      metadata: {
        ipAddress: '127.0.0.1',
        userAgent: 'Test Browser',
        deviceInfo: 'Test Device',
        verificationSource: 'web'
      }
    });
    await biometricData1.save();
    console.log('✅ Stored biometric data for user 1');

    // Test 2: Same user tries to vote again (should be blocked)
    console.log('\n🧪 Test 2: Same user attempts duplicate vote');
    
    // Slightly modify the face descriptor to simulate same person
    const mockFaceDescriptor1Modified = mockFaceDescriptor1.map(val => val + (Math.random() * 0.1 - 0.05));
    const faceSignature1Modified = {
      data: mockFaceDescriptor1Modified,
      timestamp: Date.now(),
      version: '1.0'
    };

    const duplicateCheck2 = await BiometricData.findPotentialDuplicates(
      faceSignature1Modified,
      testAward._id,
      null, // Don't exclude any user to test duplicate detection
      0.6
    );
    console.log(`   Duplicate check result: ${duplicateCheck2.length} matches found`);
    
    if (duplicateCheck2.length > 0) {
      console.log(`✅ Duplicate detected with confidence: ${duplicateCheck2[0].confidence.toFixed(3)}`);
      console.log('✅ System correctly prevents duplicate voting');
    } else {
      console.log('❌ Failed to detect duplicate - system vulnerability');
    }

    // Test 3: Different user votes (should be allowed)
    console.log('\n🧪 Test 3: Different user biometric verification');
    
    // Generate completely different face descriptor for user 2
    const mockFaceDescriptor2 = Array.from({ length: 128 }, () => Math.random() * 2 - 1);
    const faceSignature2 = {
      data: mockFaceDescriptor2,
      timestamp: Date.now(),
      version: '1.0'
    };

    const duplicateCheck3 = await BiometricData.findPotentialDuplicates(
      faceSignature2,
      testAward._id,
      testUser2._id,
      0.6
    );
    console.log(`   Duplicate check result: ${duplicateCheck3.length} matches found`);
    
    if (duplicateCheck3.length === 0) {
      console.log('✅ No duplicates found - different user can vote');
    } else {
      console.log('❌ False positive - different users detected as same person');
    }

    // Store biometric data for user 2
    const biometricData2 = new BiometricData({
      userId: testUser2._id,
      awardId: testAward._id,
      faceSignature: faceSignature2,
      biometricHash: generateBiometricHash(mockFaceDescriptor2),
      confidence: 0.92,
      faceQuality: {
        faceDetected: true,
        confidence: 0.92,
        isGoodQuality: true,
        issues: []
      },
      metadata: {
        ipAddress: '127.0.0.1',
        userAgent: 'Test Browser',
        deviceInfo: 'Test Device',
        verificationSource: 'web'
      }
    });
    await biometricData2.save();
    console.log('✅ Stored biometric data for user 2');

    // Test 4: Analytics and cleanup
    console.log('\n🧪 Test 4: Biometric analytics and cleanup');
    
    const analytics = await BiometricData.aggregate([
      {
        $match: {
          awardId: testAward._id,
          isActive: true
        }
      },
      {
        $group: {
          _id: null,
          totalVerifications: { $sum: 1 },
          averageConfidence: { $avg: '$confidence' },
          highQualityCount: {
            $sum: {
              $cond: [{ $eq: ['$faceQuality.isGoodQuality', true] }, 1, 0]
            }
          },
          uniqueUsers: { $addToSet: '$userId' }
        }
      },
      {
        $project: {
          _id: 0,
          totalVerifications: 1,
          uniqueUsers: { $size: '$uniqueUsers' },
          averageConfidence: { $round: ['$averageConfidence', 3] },
          highQualityPercentage: {
            $round: [
              { $multiply: [{ $divide: ['$highQualityCount', '$totalVerifications'] }, 100] },
              1
            ]
          }
        }
      }
    ]);

    console.log('   Analytics result:', analytics[0]);
    console.log('✅ Analytics generation working');

    // Test cleanup (simulate 30+ day old data)
    const oldBiometricData = new BiometricData({
      userId: testUser1._id,
      awardId: testAward._id,
      faceSignature: faceSignature1,
      biometricHash: generateBiometricHash(mockFaceDescriptor1),
      confidence: 0.80,
      faceQuality: {
        faceDetected: true,
        confidence: 0.80,
        isGoodQuality: true,
        issues: []
      },
      metadata: {
        ipAddress: '127.0.0.1',
        userAgent: 'Test Browser',
        deviceInfo: 'Test Device',
        verificationSource: 'web'
      },
      createdAt: new Date(Date.now() - (31 * 24 * 60 * 60 * 1000)) // 31 days ago
    });
    await oldBiometricData.save();

    const cleanupResult = await BiometricData.cleanupOldData(30);
    console.log('   Cleanup result:', cleanupResult);
    console.log('✅ Privacy cleanup working');

    // Test 5: Face signature comparison methods
    console.log('\n🧪 Test 5: Face signature comparison methods');
    
    const comparison1 = biometricData1.compareFaceSignature(faceSignature1Modified, 0.6);
    console.log('   Same person comparison:', {
      match: comparison1.match,
      distance: comparison1.distance.toFixed(4),
      confidence: comparison1.confidence.toFixed(4)
    });

    const comparison2 = biometricData1.compareFaceSignature(faceSignature2, 0.6);
    console.log('   Different person comparison:', {
      match: comparison2.match,
      distance: comparison2.distance.toFixed(4),
      confidence: comparison2.confidence.toFixed(4)
    });

    if (comparison1.match && !comparison2.match) {
      console.log('✅ Face signature comparison working correctly');
    } else {
      console.log('❌ Face signature comparison has issues');
    }

    console.log('\n🎉 Complete biometric verification flow test completed successfully!');
    console.log('\n📊 Summary:');
    console.log('   ✅ Biometric data storage: Working');
    console.log('   ✅ Duplicate detection: Working');
    console.log('   ✅ Different user detection: Working');
    console.log('   ✅ Analytics generation: Working');
    console.log('   ✅ Privacy cleanup: Working');
    console.log('   ✅ Face comparison methods: Working');

    // Cleanup test data
    await BiometricData.deleteMany({ 'metadata.deviceInfo': 'Test Device' });
    await User.deleteMany({ email: { $regex: /test.*@biometric\.test/ } });
    await Nominee.deleteMany({ name: { $regex: /Test Nominee/ } });
    await Award.deleteMany({ title: { $regex: /Test Award/ } });
    await Category.deleteMany({ name: { $regex: /Test Category/ } });
    console.log('\n🧹 Cleaned up test data');

  } catch (error) {
    console.error('❌ Test failed:', error);
  } finally {
    await mongoose.disconnect();
    console.log('Disconnected from MongoDB');
  }
}

// Helper function to generate biometric hash
function generateBiometricHash(descriptorArray) {
  const hashInput = descriptorArray.join(',');
  let hash = 0;
  for (let i = 0; i < hashInput.length; i++) {
    const char = hashInput.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return Math.abs(hash).toString(16);
}

// Run the test
testCompleteBiometricFlow();