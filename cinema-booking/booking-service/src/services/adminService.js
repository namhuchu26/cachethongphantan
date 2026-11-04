// Số liệu cho dashboard + các thao tác phục vụ demo.
const { pool } = require('../infra/db');
const { redis } = require('../infra/redis');
const { queueInfo } = require('../infra/mq');
const config = require('../config');
const { getSettings } = require('./settings');
const realtime = require('../realtime/socket');

async function scanKeys(pattern) {
  const keys = [];
  let cursor = '0';
  do {
    const [next, batch] = await redis.scan(cursor, 'MATCH', pattern, 'COUNT', 500);
    cursor = next;
    keys.push(...batch);
  } while (cursor !== '0');
  return keys;
}

// Mỗi server tự ghi "nhịp tim" lên Redis 2 giây/lần, hết hạn sau 6 giây.
// Server nào không còn nhịp tim = đã chết.
function startHeartbeat() {
  const startedAt = Date.now();
  const beat = () => redis
    .set(`server:${config.serverName}`, JSON.stringify({ name: config.serverName, startedAt, at: Date.now() }), 'EX', 6)
    .catch(() => {});
  beat();
  return setInterval(beat, 2000);
}

async function getStats() {
  const [serverKeys, requestKeys] = await Promise.all([scanKeys('server:*'), scanKeys('stats:requests:*')]);
  const alive = new Map();
  if (serverKeys.length) {
    (await redis.mget(serverKeys)).filter(Boolean).forEach((v) => {
      const s = JSON.parse(v);
      alive.set(s.name, s);
    });
  }
  const names = new Set([...alive.keys(), ...requestKeys.map((k) => k.slice('stats:requests:'.length))]);
  const sorted = [...names].sort();
  const reqCounts = sorted.length
    ? await redis.mget(sorted.map((n) => `stats:requests:${n}`)) : [];
  const servers = sorted.map((name, i) => ({
    name,
    alive: alive.has(name),
    requests: Number(reqCounts[i] || 0),
    startedAt: alive.get(name)?.startedAt ?? null,
  }));

  const [holdOk, holdConflict] = await redis.mget('stats:hold_ok', 'stats:hold_conflict');
  const byStatus = Object.fromEntries((await pool.query(
    'SELECT status, count(*)::int AS n FROM bookings GROUP BY status')).rows.map((r) => [r.status, r.n]));
  const tickets = (await pool.query('SELECT count(*)::int AS n FROM tickets')).rows[0].n;
  let queue = null;
  try { queue = await queueInfo(); } catch { /* RabbitMQ không trả lời */ }

  return {
    answeredBy: config.serverName,
    settings: await getSettings(),
    servers,
    holds: { ok: Number(holdOk || 0), conflicts: Number(holdConflict || 0) },
    bookings: { pending: byStatus.PENDING || 0, paid: byStatus.PAID || 0, failed: byStatus.FAILED || 0 },
    ticketsSold: tickets,
    queue,
  };
}

/** Xóa toàn bộ vé, đơn, khóa ghế của một suất chiếu để chạy lại demo từ đầu. */
async function resetShowtime(showtimeId) {
  await pool.query('DELETE FROM bookings WHERE showtime_id = $1', [showtimeId]);
  const seatKeys = await scanKeys(`seat:${showtimeId}:*`);
  if (seatKeys.length) await redis.del(...seatKeys);
  await redis.del('stats:hold_ok', 'stats:hold_conflict');
  realtime.toShowtime(showtimeId, 'seats_reset', {});
  return { clearedSeatKeys: seatKeys.length };
}

async function resetCounters() {
  const keys = await scanKeys('stats:*');
  if (keys.length) await redis.del(...keys);
}

module.exports = { startHeartbeat, getStats, resetShowtime, resetCounters };
