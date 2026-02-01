// MongoDB initialization script for YODECO production database

// Switch to the biometric-voting database
db = db.getSiblingDB('biometric-voting');

// Create application user
db.createUser({
  user: 'yodeco_user',
  pwd: 'your-secure-mongo-password-here', // This will be replaced by environment variable
  roles: [
    {
      role: 'readWrite',
      db: 'biometric-voting'
    }
  ]
});

// Create indexes for better performance
db.users.createIndex({ email: 1 }, { unique: true });
db.users.createIndex({ googleId: 1 }, { unique: true, sparse: true });
db.users.createIndex({ createdAt: 1 });

db.members.createIndex({ email: 1 }, { unique: true });
db.members.createIndex({ registrationNumber: 1 }, { unique: true });
db.members.createIndex({ phoneNumber: 1 }, { unique: true });
db.members.createIndex({ createdAt: 1 });

db.categories.createIndex({ name: 1 }, { unique: true });
db.categories.createIndex({ createdAt: 1 });

db.awards.createIndex({ title: 1, categoryId: 1 }, { unique: true });
db.awards.createIndex({ categoryId: 1 });
db.awards.createIndex({ createdAt: 1 });

db.nominees.createIndex({ name: 1, awardId: 1 }, { unique: true });
db.nominees.createIndex({ awardId: 1 });
db.nominees.createIndex({ createdAt: 1 });

db.votes.createIndex({ userId: 1, awardId: 1 }, { unique: true });
db.votes.createIndex({ awardId: 1 });
db.votes.createIndex({ nomineeId: 1 });
db.votes.createIndex({ createdAt: 1 });

db.biometricdata.createIndex({ userId: 1, awardId: 1 }, { unique: true });
db.biometricdata.createIndex({ createdAt: 1 });
db.biometricdata.createIndex({ 
  createdAt: 1 
}, { 
  expireAfterSeconds: 2592000 // 30 days TTL for privacy
});

db.votebias.createIndex({ awardId: 1, nomineeId: 1 }, { unique: true });
db.votebias.createIndex({ awardId: 1 });
db.votebias.createIndex({ createdAt: 1 });

print('Database initialization completed successfully');
print('Created user: yodeco_user');
print('Created indexes for all collections');
print('Set up TTL index for biometric data (30 days)');