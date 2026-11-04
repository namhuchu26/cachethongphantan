const Redis = require('ioredis');
const config = require('../config');

// Client chính cho lệnh thường, và hai client riêng cho Socket.IO Redis adapter (pub/sub)
const redis = new Redis(config.redisUrl, { maxRetriesPerRequest: 2 });
const pubClient = redis.duplicate();
const subClient = redis.duplicate();

for (const c of [redis, pubClient, subClient]) {
  c.on('error', (err) => console.error('[redis]', err.message));
}

module.exports = { redis, pubClient, subClient };
