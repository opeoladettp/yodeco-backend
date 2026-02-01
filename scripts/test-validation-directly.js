const { validate, schemas } = require('../src/middleware/validation');

function testValidationDirectly() {
  console.log('🧪 Testing Validation Directly (Simulating Frontend Requests)...\n');

  // Test scenarios that were failing before the fix
  const testCases = [
    {
      name: 'Empty string dates (common frontend issue)',
      data: {
        title: 'Test Award',
        criteria: 'Test criteria',
        categoryId: '507f1f77bcf86cd799439011',
        imageUrl: '',
        votingStartDate: '',
        votingEndDate: '',
        isActive: true,
        allowPublicNomination: false,
        nominationStartDate: '',
        nominationEndDate: ''
      }
    },
    {
      name: 'Null dates',
      data: {
        title: 'Test Award',
        criteria: 'Test criteria',
        categoryId: '507f1f77bcf86cd799439011',
        votingStartDate: null,
        votingEndDate: null,
        isActive: true,
        allowPublicNomination: false,
        nominationStartDate: null,
        nominationEndDate: null
      }
    },
    {
      name: 'Undefined dates (missing fields)',
      data: {
        title: 'Test Award',
        criteria: 'Test criteria',
        categoryId: '507f1f77bcf86cd799439011',
        isActive: true,
        allowPublicNomination: false
        // Date fields completely missing
      }
    },
    {
      name: 'Valid ISO dates',
      data: {
        title: 'Test Award',
        criteria: 'Test criteria',
        categoryId: '507f1f77bcf86cd799439011',
        isActive: true,
        allowPublicNomination: true,
        nominationStartDate: '2024-01-15T10:00:00.000Z',
        nominationEndDate: '2024-01-31T18:00:00.000Z',
        votingStartDate: '2024-02-01T09:00:00.000Z',
        votingEndDate: '2024-02-28T17:00:00.000Z'
      }
    },
    {
      name: 'Frontend datetime-local format',
      data: {
        title: 'Test Award',
        criteria: 'Test criteria',
        categoryId: '507f1f77bcf86cd799439011',
        isActive: true,
        allowPublicNomination: true,
        nominationStartDate: '2024-01-15T10:30',
        nominationEndDate: '2024-01-31T18:00',
        votingStartDate: '2024-02-01T09:00',
        votingEndDate: '2024-02-28T17:00'
      }
    },
    {
      name: 'Mixed scenario (some dates empty, some valid)',
      data: {
        title: 'Test Award',
        criteria: 'Test criteria',
        categoryId: '507f1f77bcf86cd799439011',
        isActive: true,
        allowPublicNomination: false,
        nominationStartDate: '',
        nominationEndDate: '',
        votingStartDate: '2024-02-01T09:00:00.000Z',
        votingEndDate: '2024-02-28T17:00:00.000Z'
      }
    }
  ];

  let passedTests = 0;
  let totalTests = testCases.length;

  testCases.forEach((testCase, index) => {
    console.log(`🧪 Test ${index + 1}: ${testCase.name}`);
    
    try {
      const { error } = schemas.awardCreation.validate(testCase.data);
      
      if (error) {
        console.log('❌ FAILED - Validation errors:');
        error.details.forEach(detail => {
          console.log(`   - ${detail.message}`);
        });
      } else {
        console.log('✅ PASSED - Validation successful');
        passedTests++;
      }
    } catch (err) {
      console.log('❌ FAILED - Exception during validation:', err.message);
    }
    
    console.log(''); // Empty line for readability
  });

  // Summary
  console.log('📊 VALIDATION TEST SUMMARY');
  console.log('=' .repeat(50));
  console.log(`Total Tests: ${totalTests}`);
  console.log(`Passed: ${passedTests}`);
  console.log(`Failed: ${totalTests - passedTests}`);
  console.log(`Success Rate: ${((passedTests / totalTests) * 100).toFixed(1)}%`);

  if (passedTests === totalTests) {
    console.log('\n🎉 ALL TESTS PASSED! Award creation validation is working correctly.');
    console.log('✅ The "nominationStartDate must be a valid date" error should be fixed.');
  } else {
    console.log('\n❌ Some tests failed. The validation fix may need additional work.');
  }

  // Test the specific error case that was reported
  console.log('\n🔍 SPECIFIC ERROR CASE TEST');
  console.log('Testing the exact scenario that was causing "nominationStartDate must be a valid date"...');
  
  const problematicCase = {
    title: 'Real Award Example',
    criteria: 'Real criteria example',
    categoryId: '507f1f77bcf86cd799439011',
    allowPublicNomination: true,
    nominationStartDate: '', // This was causing the error
    nominationEndDate: '',
    votingStartDate: '',
    votingEndDate: '',
    isActive: true
  };

  const { error: specificError } = schemas.awardCreation.validate(problematicCase);
  
  if (specificError) {
    console.log('❌ The specific error case is still failing:');
    specificError.details.forEach(detail => {
      console.log(`   - ${detail.message}`);
    });
  } else {
    console.log('✅ The specific error case is now FIXED!');
  }
}

// Run the test
testValidationDirectly();