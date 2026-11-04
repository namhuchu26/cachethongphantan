// Kiểm thử khóa ghế với Redis thật.
// Chạy:  docker compose exec booking-1 npm test
const test = require('node:test');
const assert = require('node:assert');
const Redis = require('ioredis');
const { createSeatLock, seatKey } = require('../src/services/seatLock');

const redis = new Redis(process.env.REDIS_URL || 'redis://localhost:6380');
const lock = createSeatLock(redis);
const ST = 9999; // suất chiếu giả, không đụng dữ liệu thật

async function clean() {
  const keys = await redis.keys(`seat:${ST}:*`);
  if (keys.length) await redis.del(...keys);
}

test.beforeEach(clean);
test.after(async () => { await clean(); redis.disconnect(); });

test('giữ ghế trống thành công và có TTL', async () => {
  const r = await lock.hold(ST, [1, 2], 'an:t1', 60);
  assert.equal(r.ok, true);
  assert.equal(await redis.get(seatKey(ST, 1)), 'an:t1');
  const ttl = await redis.ttl(seatKey(ST, 1));
  assert.ok(ttl > 0 && ttl <= 60);
});

test('ghế đã có người giữ thì người sau bị từ chối', async () => {
  await lock.hold(ST, [5], 'an:t1', 60);
  const r = await lock.hold(ST, [5], 'binh:t2', 60);
  assert.equal(r.ok, false);
  assert.equal(r.conflictSeatId, 5);
});

test('giữ nhiều ghế là nguyên tử: trùng 1 ghế thì không giữ ghế nào', async () => {
  await lock.hold(ST, [3], 'an:t1', 60);
  const r = await lock.hold(ST, [1, 2, 3], 'binh:t2', 60);
  assert.equal(r.ok, false);
  assert.equal(await redis.exists(seatKey(ST, 1)), 0);
  assert.equal(await redis.exists(seatKey(ST, 2)), 0);
});

test('nhả ghế sai token không xóa được khóa của người khác', async () => {
  await lock.hold(ST, [7], 'an:t1', 60);
  assert.equal(await lock.release(ST, [7], 'binh:t2'), 0);
  assert.equal(await redis.get(seatKey(ST, 7)), 'an:t1');
  assert.equal(await lock.release(ST, [7], 'an:t1'), 1);
  assert.equal(await redis.exists(seatKey(ST, 7)), 0);
});

test('verifyAndExtend chỉ gia hạn khi ghế còn thuộc lượt giữ', async () => {
  await lock.hold(ST, [8], 'an:t1', 30);
  assert.equal(await lock.verifyAndExtend(ST, [8], 'an:t1', 100), true);
  assert.ok((await redis.ttl(seatKey(ST, 8))) > 100);
  assert.equal(await lock.verifyAndExtend(ST, [8], 'binh:t2', 100), false);
});

test('ghế đã bán (SOLD) không bao giờ giữ được nữa', async () => {
  await lock.hold(ST, [9], 'an:t1', 30);
  await lock.markSold(ST, [9]);
  assert.equal(await redis.ttl(seatKey(ST, 9)), -1); // không còn TTL
  assert.equal((await lock.hold(ST, [9], 'binh:t2', 30)).ok, false);
});

test('BẬT khóa: 50 người tranh 1 ghế cùng lúc → đúng 1 người thắng', async () => {
  const results = await Promise.all(
    Array.from({ length: 50 }, (_, i) => lock.hold(ST, [42], `u${i}:t${i}`, 60)));
  assert.equal(results.filter((r) => r.ok).length, 1);
});

test('TẮT khóa (holdUnsafe): race condition cho phép nhiều người cùng thắng', async () => {
  // Dùng nhiều kết nối như nhiều server thật
  const clients = Array.from({ length: 10 }, () => new Redis(process.env.REDIS_URL || 'redis://localhost:6380'));
  const locks = clients.map((c) => createSeatLock(c));
  const results = await Promise.all(locks.map((l, i) => l.holdUnsafe(ST, [43], `u${i}:t${i}`, 60)));
  clients.forEach((c) => c.disconnect());
  const winners = results.filter((r) => r.ok).length;
  console.log(`  holdUnsafe: ${winners}/10 người cùng "giữ được" ghế 43`);
  assert.ok(winners > 1, 'mong đợi có race condition khi tắt khóa');
});
