// PAYMENT WORKER
// Lấy đơn từ hàng đợi "payments", giả lập thanh toán, ghi vé vào PostgreSQL trong một transaction.
// Chỉ ACK sau khi ghi xong → Worker chết giữa chừng thì RabbitMQ giao lại đơn (không mất đơn).
// Đơn bị giao lại không tạo vé trùng vì Worker kiểm tra trạng thái đơn (idempotent)
// và bảng tickets có UNIQUE (showtime_id, seat_id).
const amqp = require('amqplib');
const crypto = require('crypto');
const Redis = require('ioredis');
const { Pool } = require('pg');
const { Emitter } = require('@socket.io/redis-emitter');

const QUEUE = 'payments';
const DLX = 'payments.dlx';
const DLQ = 'payments.dlq';
const MAX_RETRIES = 3;
const DELAY_MS = Number(process.env.PAYMENT_DELAY_MS || 800);
const FAIL_RATE = Number(process.env.PAYMENT_FAIL_RATE || 0); // tỉ lệ giả lập thẻ bị từ chối

const pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 5 });
const redis = new Redis(process.env.REDIS_URL);
const emitter = new Emitter(redis);   // phát sự kiện Socket.IO tới mọi Booking Server qua Redis

// Đánh dấu ghế đã bán: bỏ TTL, giá trị SOLD
redis.defineCommand('seatMarkSold', {
  lua: `for i, key in ipairs(KEYS) do redis.call('SET', key, 'SOLD') end return 1`,
});
// Nhả những ghế còn thuộc lượt giữ này; trả về vị trí các ghế đã nhả
redis.defineCommand('seatReleaseOwned', {
  lua: `local out = {}
        for i, key in ipairs(KEYS) do
          if redis.call('GET', key) == ARGV[1] then redis.call('DEL', key); table.insert(out, i) end
        end
        return out`,
});

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const seatKeys = (job) => job.seatIds.map((id) => `seat:${job.showtimeId}:${id}`);
const newCode = () => crypto.randomBytes(4).toString('hex').toUpperCase();
const log = (...a) => console.log(new Date().toISOString(), ...a);

class BusinessError extends Error {}

async function markFailed(job, reason) {
  await pool.query(
    `UPDATE bookings SET status = 'FAILED', error = $2, updated_at = now() WHERE id = $1 AND status = 'PENDING'`,
    [job.bookingId, reason]);
  const keys = seatKeys(job);
  const idx = await redis.seatReleaseOwned(keys.length, ...keys, `${job.userId}:${job.holdToken}`);
  const released = idx.map((i) => job.seatIds[i - 1]);
  if (released.length) {
    emitter.to(`showtime:${job.showtimeId}`).emit('seats_released',
      { showtimeId: job.showtimeId, seatIds: released, by: 'payment-worker' });
  }
  emitter.to(`user:${job.userId}`).emit('booking_result',
    { bookingId: job.bookingId, status: 'FAILED', error: reason });
  log(`[FAILED] booking ${job.bookingId}: ${reason}`);
}

async function processJob(job) {
  const pre = await pool.query('SELECT status FROM bookings WHERE id = $1', [job.bookingId]);
  if (pre.rowCount === 0 || pre.rows[0].status !== 'PENDING') {
    log(`[SKIP] booking ${job.bookingId} đã xử lý trước đó (${pre.rows[0]?.status || 'không tồn tại'})`);
    return;
  }

  await sleep(DELAY_MS); // giả lập gọi cổng thanh toán
  if (Math.random() < FAIL_RATE) throw new BusinessError('Thanh toán bị từ chối (giả lập)');

  const client = await pool.connect();
  const code = newCode();
  try {
    await client.query('BEGIN');
    const b = await client.query('SELECT status FROM bookings WHERE id = $1 FOR UPDATE', [job.bookingId]);
    if (b.rows[0].status !== 'PENDING') {           // Worker khác (hoặc lần giao trước) đã xử lý
      await client.query('ROLLBACK');
      return;
    }
    // UNIQUE (showtime_id, seat_id) → nếu ghế đã có vé, câu lệnh này lỗi 23505
    await client.query(
      `INSERT INTO tickets (booking_id, showtime_id, seat_id)
       SELECT $1, $2, unnest($3::int[])`, [job.bookingId, job.showtimeId, job.seatIds]);
    await client.query(
      `UPDATE bookings SET status = 'PAID', code = $2, updated_at = now() WHERE id = $1`, [job.bookingId, code]);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    if (err.code === '23505') throw new BusinessError('Ghế đã được bán cho người khác (chặn bởi UNIQUE trong database)');
    throw err;
  } finally {
    client.release();
  }

  const keys = seatKeys(job);
  await redis.seatMarkSold(keys.length, ...keys);
  await redis.del(`hold:${job.holdToken}`);
  emitter.to(`showtime:${job.showtimeId}`).emit('seats_sold',
    { showtimeId: job.showtimeId, seatIds: job.seatIds, by: 'payment-worker' });
  emitter.to(`user:${job.userId}`).emit('booking_result', { bookingId: job.bookingId, status: 'PAID', code });
  log(`[PAID] booking ${job.bookingId} ghế ${job.seatIds.join(',')} mã ${code}`);
}

async function connectWithRetry() {
  for (let i = 1; ; i++) {
    try {
      return await amqp.connect(process.env.AMQP_URL);
    } catch (err) {
      log(`[mq] chưa kết nối được (lần ${i}): ${err.message}`);
      await sleep(2000);
    }
  }
}

async function main() {
  const conn = await connectWithRetry();
  conn.on('close', () => { log('[mq] mất kết nối, thoát để Docker khởi động lại'); process.exit(1); });
  const ch = await conn.createChannel();
  await ch.assertExchange(DLX, 'direct', { durable: true });
  await ch.assertQueue(DLQ, { durable: true });
  await ch.bindQueue(DLQ, DLX, DLQ);
  await ch.assertQueue(QUEUE, { durable: true, deadLetterExchange: DLX, deadLetterRoutingKey: DLQ });
  await ch.prefetch(5); // mỗi lần nhận tối đa 5 đơn chưa ACK

  log(`[worker] đang chờ đơn trên hàng đợi "${QUEUE}"`);
  await ch.consume(QUEUE, async (msg) => {
    if (!msg) return;
    let job;
    try {
      job = JSON.parse(msg.content.toString());
    } catch {
      ch.nack(msg, false, false); // message hỏng → dead-letter
      return;
    }
    const retries = Number(msg.properties.headers?.['x-retries'] || 0);
    try {
      await processJob(job);
      ch.ack(msg);                                   // CHỈ ack khi đã ghi xong
    } catch (err) {
      if (err instanceof BusinessError) {            // lỗi nghiệp vụ: đánh dấu FAILED, không thử lại
        await markFailed(job, err.message).catch((e) => log('[markFailed]', e.message));
        ch.ack(msg);
      } else if (retries < MAX_RETRIES) {            // lỗi tạm thời (DB/Redis chập chờn): thử lại
        log(`[RETRY ${retries + 1}/${MAX_RETRIES}] booking ${job.bookingId}: ${err.message}`);
        await sleep(2000);
        ch.sendToQueue(QUEUE, msg.content, {
          persistent: true, contentType: 'application/json', headers: { 'x-retries': retries + 1 },
        });
        ch.ack(msg);
      } else {                                       // thử mãi không được → dead-letter queue
        log(`[DEAD-LETTER] booking ${job.bookingId}: ${err.message}`);
        ch.nack(msg, false, false);
      }
    }
  }, { noAck: false });

  const shutdown = async () => { log('[worker] dừng'); await ch.close().catch(() => {}); process.exit(0); };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch((err) => { console.error(err); process.exit(1); });
