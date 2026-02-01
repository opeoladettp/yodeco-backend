require('dotenv').config();
const redis = require('redis');

const awardId = process.argv[2];

if (!awardId) {
  console.error('Usage: node invalidate-vote-cache.js <awardId>');
  process.exit(1);
}

const client = redis.createClient({
  url: process.env.REDIS_URL || 'redis://localhost:6379'
});

client.connect()
  .then(() => {
    console.log('Connected to Redis');
    const cacheKey = `vote_counts:${awardId}`;
    console.log(`Deleting cache key: ${cacheKey}`);
    return client.del(cacheKey);
  })
  .then((result) => {
    console.log(`✅ Cache invalidated. Keys deleted: ${result}`);
    return client.quit();
  })
  .then(() => {
    console.log('✅ Done!');
    process.exit(0);
  })
  .catch(err => {
    console.error('❌ Error:', err);
    process.exit(1);
  });
