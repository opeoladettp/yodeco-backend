// Test setup file
// This file runs before each test suite

// Load environment variables first
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const mongoose = require('mongoose');
const { MongoMemoryServer } = require('mongodb-memory-server');

let mongoServer;
let mockRedisClient;

// Mock Redis client for testing
const createMockRedisClient = () => {
  const store = new Map();
  const hashStore = new Map(); // For hash operations
  
  return {
    get: jest.fn(async (key) => {
      return store.get(key) || null;
    }),
    set: jest.fn(async (key, value, ...args) => {
      // Handle SET with options like EX, NX
      if (args.includes('NX') && store.has(key)) {
        return null; // Key already exists
      }
      store.set(key, value);
      return 'OK';
    }),
    setex: jest.fn(async (key, ttl, value) => {
      store.set(key, value);
      return 'OK';
    }),
    setEx: jest.fn(async (key, ttl, value) => {
      store.set(key, value);
      return 'OK';
    }),
    del: jest.fn(async (key) => {
      const existed = store.has(key);
      store.delete(key);
      hashStore.delete(key); // Also clean up hash store
      return existed ? 1 : 0;
    }),
    keys: jest.fn(async (pattern) => {
      // Simple pattern matching for testing
      const allKeys = Array.from(store.keys());
      if (pattern === '*') {
        return allKeys;
      }
      // Basic wildcard support
      const regex = new RegExp(pattern.replace(/\*/g, '.*'));
      return allKeys.filter(key => regex.test(key));
    }),
    mget: jest.fn(async (keys) => {
      return keys.map(key => store.get(key) || null);
    }),
    // Hash operations
    hIncrBy: jest.fn(async (key, field, increment) => {
      if (!hashStore.has(key)) {
        hashStore.set(key, new Map());
      }
      const hash = hashStore.get(key);
      const currentValue = parseInt(hash.get(field) || '0', 10);
      const newValue = currentValue + increment;
      hash.set(field, newValue.toString());
      return newValue;
    }),
    hGetAll: jest.fn(async (key) => {
      const hash = hashStore.get(key);
      if (!hash) {
        return {};
      }
      const result = {};
      for (const [field, value] of hash.entries()) {
        result[field] = value;
      }
      return result;
    }),
    incr: jest.fn(async (key) => {
      const current = parseInt(store.get(key) || '0', 10);
      const newValue = current + 1;
      store.set(key, newValue.toString());
      return newValue;
    }),
    pExpire: jest.fn(async (key, milliseconds) => {
      // Mock expiration - in real implementation this would set TTL
      return 1;
    }),
    flushDb: jest.fn(async () => {
      store.clear();
      hashStore.clear();
      return 'OK';
    }),
    ping: jest.fn(async () => 'PONG'),
    quit: jest.fn(async () => 'OK'),
    connect: jest.fn(async () => {}),
    disconnect: jest.fn(async () => {}),
    isReady: true,
    isOpen: true
  };
};

// Mock the Redis config module
jest.mock('../src/config/redis', () => {
  let mockClient = null;
  
  return {
    connectRedis: jest.fn(async () => {
      mockClient = createMockRedisClient();
      return mockClient;
    }),
    getRedisClient: jest.fn(() => {
      if (!mockClient) {
        mockClient = createMockRedisClient();
      }
      return mockClient;
    })
  };
});

// Setup test database
beforeAll(async () => {
  // Close any existing connections
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
  }
  
  // Use in-memory MongoDB for testing
  mongoServer = await MongoMemoryServer.create();
  const mongoUri = mongoServer.getUri();
  
  await mongoose.connect(mongoUri);
  
  // Initialize mock Redis client
  mockRedisClient = createMockRedisClient();
});

// Cleanup after tests
afterAll(async () => {
  await mongoose.disconnect();
  if (mongoServer) {
    await mongoServer.stop();
  }
});

// Clear database and Redis between tests
afterEach(async () => {
  const collections = mongoose.connection.collections;
  for (const key in collections) {
    const collection = collections[key];
    await collection.deleteMany({});
  }
  
  // Clear mock Redis
  if (mockRedisClient) {
    await mockRedisClient.flushDb();
  }
});