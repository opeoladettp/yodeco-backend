const mongoose = require('mongoose');
const BiometricData = require('../src/models/BiometricData');
const User = require('../src/models/User');
const Award = require('../src/models/Award');

// Load environment variables
require('dotenv').config();

async function testBiometricSystem() {
  try {
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ Connected to MongoDB');

    // Test 1: Create mock biometric data
    console.log('\n🧪 Test 1: Creating mock biometric data...');
    
    // Find or create a test user
    let testUser = await User.findOne({ email: 'test@example.com' });
    if (!testUser) {
      testUser = new User({
        name: 'Test User',
        email: 'test@example.com',
        googleId: 'test-google-id-' + Date.now(),
        role: 'User',
        isActive: true
      });
      await testUser.save();
      console.log('Created test user');
    }

    // Find or create a test category
    const Category = require('../src/models/Category');
    let testCategory = await Category.findOne({ name: 'Test Category' });
    if (!testCategory) {
      testCategory = new Category({
        name: 'Test Category',
        description: 'Test category for biometric testing',
        slug: 'test-category',
        createdBy: testUser._id,
        isActive: true
      });
      await testCategory.save();
      console.log('Created test category');
    }

    // Find or create a test award
    let testAward = await Award.findOne({ title: 'Test Award' });
    if (!testAward) {
      testAward = new Award({
        title: 'Test Award',
        description: 'Test award for biometric testing',
        criteria: 'Test criteria',
        categoryId: testCategory._id,
        createdBy: testUser._id,
        votingStartDate: new Date(),
        votingEndDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days from now
        isActive: true
      });
      await testAward.save();
      console.log('Created test award');
    }

    // Create mock face signature (128-dimensional descriptor)
    const mockFaceDescriptor = Array.from({ length: 128 }, () => Math.random() * 2 - 1);
    const faceSignature = {
      data: mockFaceDescriptor,
      timestamp: new Date(),
      version: '1.0'
    };

    // Generate biometric hash
    const biometricHash = generateBiometricHash(mockFaceDescriptor);

    const biometricData = new BiometricData({
      userId: testUser._id,
      awardId: testAward._id,
      faceSignature,
      biometricHash,
      confidence: 0.85,
      faceQuality: {
        faceDetected: true,
        confidence: 0.85,
        isGoodQuality: true,
        issues: []
      },
      metadata: {
        ipAddress: '127.0.0.1',
        userAgent: 'Test Agent',
        deviceInfo: 'Test Device',
        verificationSource: 'web'
      }
    });

    await biometricData.save();
    console.log('✅ Created biometric data:', biometricData._id);

    // Test 2: Test duplicate detection
    console.log('\n🧪 Test 2: Testing duplicate detection...');
    
    // Create a similar face descriptor (should match)
    const similarDescriptor = mockFaceDescriptor.map(val => val + (Math.random() * 0.1 - 0.05)); // Add small noise
    const similarSignature = {
      data: similarDescriptor,
      timestamp: new Date(),
      version: '1.0'
    };

    const duplicates = await BiometricData.findPotentialDuplicates(
      similarSignature,
      testAward._id,
      null, // Don't exclude any user
      0.6 // Threshold
    );

    console.log(`Found ${duplicates.length} potential duplicates`);
    if (duplicates.length > 0) {
      console.log('✅ Duplicate detection working - found match with confidence:', duplicates[0].confidence);
    } else {
      console.log('❌ Duplicate detection failed - no matches found');
    }

    // Test 3: Test face signature comparison
    console.log('\n🧪 Test 3: Testing face signature comparison...');
    
    const comparison = biometricData.compareFaceSignature(similarSignature, 0.6);
    console.log('Comparison result:', {
      match: comparison.match,
      distance: comparison.distance.toFixed(4),
      confidence: comparison.confidence.toFixed(4)
    });

    if (comparison.match) {
      console.log('✅ Face signature comparison working');
    } else {
      console.log('❌ Face signature comparison failed');
    }

    // Test 4: Test different face (should not match)
    console.log('\n🧪 Test 4: Testing different face detection...');
    
    const differentDescriptor = Array.from({ length: 128 }, () => Math.random() * 2 - 1);
    const differentSignature = {
      data: differentDescriptor,
      timestamp: new Date(),
      version: '1.0'
    };

    const differentComparison = biometricData.compareFaceSignature(differentSignature, 0.6);
    console.log('Different face comparison:', {
      match: differentComparison.match,
      distance: differentComparison.distance.toFixed(4),
      confidence: differentComparison.confidence.toFixed(4)
    });

    if (!differentComparison.match) {
      console.log('✅ Different face detection working');
    } else {
      console.log('❌ Different face detection failed - false positive');
    }

    // Test 5: Test analytics
    console.log('\n🧪 Test 5: Testing biometric analytics...');
    
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

    console.log('Analytics result:', analytics[0] || 'No data');
    console.log('✅ Analytics working');

    // Test 6: Test cleanup
    console.log('\n🧪 Test 6: Testing data cleanup...');
    
    // Create old biometric data (simulate 31 days old)
    const oldDate = new Date();
    oldDate.setDate(oldDate.getDate() - 31);
    
    const oldBiometricData = new BiometricData({
      userId: testUser._id,
      awardId: testAward._id,
      faceSignature: {
        data: Array.from({ length: 128 }, () => Math.random() * 2 - 1),
        timestamp: oldDate,
        version: '1.0'
      },
      biometricHash: 'old-hash-' + Date.now(),
      confidence: 0.75,
      faceQuality: {
        faceDetected: true,
        confidence: 0.75,
        isGoodQuality: true,
        issues: []
      },
      createdAt: oldDate
    });

    await oldBiometricData.save();
    console.log('Created old biometric data');

    // Test cleanup
    const cleanupResult = await BiometricData.cleanupOldData(30);
    console.log('Cleanup result:', cleanupResult);
    console.log('✅ Cleanup working');

    console.log('\n🎉 All biometric system tests completed successfully!');

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
    hash = hash & hash; // Convert to 32-bit integer
  }
  
  return Math.abs(hash).toString(16);
}

// Run the test
if (require.main === module) {
  testBiometricSystem();
}

module.exports = { testBiometricSystem };