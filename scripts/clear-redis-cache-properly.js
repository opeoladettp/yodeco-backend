const mongoose = require('mongoose');
const { connectRedis, getRedisClient } = require('../src/config/redis');
const { Award } = require('../src/models');

async function clearRedisCacheProperly() {
  try {
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/biometric-voting');
    console.log('Connected to MongoDB');

    // Connect to Redis
    await connectRedis();
    console.log('Connected to Redis');

    const award = await Award.findOne({ title: /Best Perorming Senetor/ });
    console.log(`\nClearing Redis cache for award: ${award.title} (${award._id})`);

    const redisClient = getRedisClient();
    
    // Check what's currently in the cache
    console.log('\n=== Current Cache Contents ===');
    const cacheKey = `vote_counts:${award._id}`;
    const cachedData = await redisClient.hGetAll(cacheKey);
    console.log(`Cache key: ${cacheKey}`);
    console.log('Cached data:', cachedData);

    // Clear the specific cache key
    const deleteResult = await redisClient.del(cacheKey);
    console.log(`\nCache deletion result: ${deleteResult} key(s) deleted`);

    // Also clear any related keys
    const pattern = `*${award._id}*`;
    const keys = await redisClient.keys(pattern);
    console.log(`\nFound ${keys.length} keys matching pattern "${pattern}":`, keys);
    
    if (keys.length > 0) {
      const deleteAllResult = await redisClient.del(keys);
      console.log(`Deleted ${deleteAllResult} additional key(s)`);
    }

    // Verify cache is cleared
    console.log('\n=== Verifying Cache is Cleared ===');
    const verifyData = await redisClient.hGetAll(cacheKey);
    console.log('Cache after deletion:', verifyData);

    console.log('\n✓ Redis cache cleared successfully!');
    console.log('Now test the API endpoint again to see fresh data.');

  } catch (error) {
    console.error('Error:', error);
  } finally {
    // Cleanup
    try {
      const redisClient = getRedisClient();
      await redisClient.quit();
      console.log('Redis connection closed');
    } catch (e) {
      // Redis might not be connected
    }
    
    await mongoose.disconnect();
    console.log('MongoDB connection closed');
  }
}

clearRedisCacheProperly();