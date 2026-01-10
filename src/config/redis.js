const { createClient } = require('redis');

let redisClient = null;

const connectRedis = async () => {
  try {
    const redisURL = process.env.REDIS_URL || 'redis://localhost:6379';
    
    redisClient = createClient({
      url: redisURL,
      socket: {
        connectTimeout: 5000,
        lazyConnect: true,
      },
      retry_strategy: (options) => {
        if (options.error && options.error.code === 'ECONNREFUSED') {
          console.error('Redis server connection refused');
          return new Error('Redis server connection refused');
        }
        if (options.total_retry_time > 1000 * 60 * 60) {
          console.error('Redis retry time exhausted');
          return new Error('Retry time exhausted');
        }
        if (options.attempt > 10) {
          console.error('Redis max retry attempts reached');
          return undefined;
        }
        // Reconnect after
        return Math.min(options.attempt * 100, 3000);
      }
    });

    redisClient.on('error', (err) => {
      console.error('Redis Client Error:', err);
    });

    redisClient.on('connect', () => {
      console.log('Redis Client Connected');
    });

    redisClient.on('ready', () => {
      console.log('Redis Client Ready');
    });

    redisClient.on('end', () => {
      console.log('Redis Client Disconnected');
    });

    await redisClient.connect();
    
    // Test the connection
    await redisClient.ping();
    console.log('Redis connection successful');
    
    // Graceful shutdown
    process.on('SIGINT', async () => {
      if (redisClient) {
        await redisClient.quit();
        console.log('Redis connection closed through app termination');
      }
    });
    
  } catch (error) {
    console.error('Redis connection failed:', error);
    throw error;
  }
};

const getRedisClient = () => {
  if (!redisClient) {
    throw new Error('Redis client not initialized. Call connectRedis() first.');
  }
  return redisClient;
};

module.exports = {
  connectRedis,
  getRedisClient
};