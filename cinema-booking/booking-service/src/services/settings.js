// Cấu hình dùng chung cho MỌI server, lưu trên Redis để đổi lúc chạy (phục vụ demo).
const { redis } = require('../infra/redis');
const config = require('../config');

async function getSettings() {
  const [lock, ttl] = await redis.mget('config:lock_enabled', 'config:hold_ttl');
  return {
    lockEnabled: lock !== '0',                       // mặc định BẬT khóa
    holdTtl: ttl ? Number(ttl) : config.defaultHoldTtl,
  };
}

async function setLockEnabled(enabled) {
  await redis.set('config:lock_enabled', enabled ? '1' : '0');
}

async function setHoldTtl(seconds) {
  await redis.set('config:hold_ttl', String(seconds));
}

module.exports = { getSettings, setLockEnabled, setHoldTtl };
