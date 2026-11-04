// Giữ ghế / nhả ghế.
//
// Mỗi người có MỘT "lượt giữ" (holdToken) cho mỗi suất chiếu, giống giỏ hàng:
//  - Bấm ghế đầu tiên → tạo lượt giữ mới, bắt đầu đếm ngược (mặc định 5 phút).
//  - Bấm thêm ghế    → ghế mới được khóa với CÙNG holdToken và cùng thời điểm hết hạn.
//  - Bấm lại ghế của mình → nhả riêng ghế đó.
// Ghế bị khóa ngay khi bấm nên mọi khách khác thấy ghế chuyển vàng tức thì.
const crypto = require('crypto');
const { pool } = require('../infra/db');
const { redis } = require('../infra/redis');
const config = require('../config');
const { HttpError } = require('../errors');
const { getSettings } = require('./settings');
const { getShowtime, seatLabel, seatLock } = require('./catalogService');
const realtime = require('../realtime/socket');

const holdKey = (token) => `hold:${token}`;
const MIN_REMAINING_MS = 2000; // lượt giữ sắp hết hạn thì tạo lượt mới thay vì gộp vào

function parseSeatIds(raw) {
  if (!Array.isArray(raw) || raw.length === 0) throw new HttpError(400, 'Chưa chọn ghế');
  const ids = [...new Set(raw.map(Number))];
  if (ids.some((id) => !Number.isInteger(id))) throw new HttpError(400, 'Mã ghế không hợp lệ');
  return ids.sort((a, b) => a - b);
}

async function getHold(holdToken) {
  if (!holdToken) return null;
  const h = await redis.hgetall(holdKey(holdToken));
  if (!h || !h.userId) return null;
  return {
    holdToken,
    userId: h.userId,
    showtimeId: Number(h.showtimeId),
    seatIds: JSON.parse(h.seatIds),
    expiresAt: Number(h.expiresAt),
    paying: h.paying === '1',
  };
}

/**
 * Giữ ghế. Có holdToken còn hạn → gộp ghế mới vào lượt giữ đó; không có → tạo lượt giữ mới.
 */
async function holdSeats(userId, showtimeId, rawSeatIds, existingToken) {
  const seatIds = parseSeatIds(rawSeatIds);
  const st = await getShowtime(showtimeId);
  if (!st) throw new HttpError(404, 'Không tìm thấy suất chiếu');
  if (seatIds.some((id) => !st.seatById.has(id))) throw new HttpError(400, 'Ghế không thuộc phòng chiếu này');

  let hold = await getHold(existingToken);
  if (hold) {
    if (hold.userId !== userId || hold.showtimeId !== showtimeId) throw new HttpError(403, 'Lượt giữ ghế không hợp lệ');
    if (hold.paying) throw new HttpError(409, 'Đơn đang thanh toán, không thêm ghế được');
    if (hold.expiresAt - Date.now() < MIN_REMAINING_MS) hold = null;
  }

  const newIds = hold ? seatIds.filter((id) => !hold.seatIds.includes(id)) : seatIds;
  const already = hold ? hold.seatIds.length : 0;
  if (already + newIds.length > config.maxSeatsPerHold) {
    throw new HttpError(400, `Chỉ được giữ tối đa ${config.maxSeatsPerHold} ghế`);
  }
  if (newIds.length === 0) {
    return { holdToken: hold.holdToken, showtimeId, seatIds: hold.seatIds, addedSeatIds: [], expiresAt: hold.expiresAt };
  }

  // Ghế đã bán (đọc từ PostgreSQL – nguồn dữ liệu chính thức)
  const sold = await pool.query(
    'SELECT seat_id FROM tickets WHERE showtime_id = $1 AND seat_id = ANY($2::int[]) LIMIT 1',
    [showtimeId, newIds]);
  if (sold.rowCount > 0) {
    await redis.incr('stats:hold_conflict');
    const label = seatLabel(st.seatById.get(sold.rows[0].seat_id));
    throw new HttpError(409, `Ghế ${label} đã được bán`, { seatId: sold.rows[0].seat_id });
  }

  const { lockEnabled, holdTtl } = await getSettings();
  const holdToken = hold ? hold.holdToken : crypto.randomUUID();
  const expiresAt = hold ? hold.expiresAt : Date.now() + holdTtl * 1000;
  const ttl = Math.max(1, Math.ceil((expiresAt - Date.now()) / 1000)); // ghế thêm sau hết hạn CÙNG lúc
  const value = `${userId}:${holdToken}`;

  // BẬT khóa: script Lua nguyên tử. TẮT khóa: GET rồi SET (cố ý sai để demo race condition).
  const result = lockEnabled
    ? await seatLock.hold(showtimeId, newIds, value, ttl)
    : await seatLock.holdUnsafe(showtimeId, newIds, value, ttl);

  if (!result.ok) {
    await redis.incr('stats:hold_conflict');
    const label = seatLabel(st.seatById.get(result.conflictSeatId));
    throw new HttpError(409, `Ghế ${label} đã có người chọn`, { seatId: result.conflictSeatId });
  }

  await redis.incr('stats:hold_ok');
  const allIds = [...(hold ? hold.seatIds : []), ...newIds].sort((a, b) => a - b);
  const tx = redis.multi().hset(holdKey(holdToken), {
    showtimeId: String(showtimeId), seatIds: JSON.stringify(allIds), userId, expiresAt: String(expiresAt),
  });
  // giữ thông tin lượt giữ lâu hơn khóa ghế một chút, để còn dùng khi thanh toán
  if (!hold) tx.expire(holdKey(holdToken), holdTtl + config.paymentExtendSeconds + 60);
  await tx.exec();

  realtime.toShowtime(showtimeId, 'seats_held', { seatIds: newIds, userId });
  return { holdToken, showtimeId, seatIds: allIds, addedSeatIds: newIds, expiresAt, ttl, lockEnabled };
}

/** Nhả ghế: không truyền seatIds = nhả tất cả; có seatIds = chỉ nhả những ghế đó. */
async function releaseSeats(userId, holdToken, onlySeatIds = null) {
  const hold = await getHold(holdToken);
  if (!hold) throw new HttpError(404, 'Lượt giữ ghế không tồn tại hoặc đã hết hạn');
  if (hold.userId !== userId) throw new HttpError(403, 'Không phải ghế bạn đang giữ');
  if (hold.paying) throw new HttpError(409, 'Đơn đang thanh toán, không bỏ ghế được');

  const ids = onlySeatIds ? hold.seatIds.filter((id) => onlySeatIds.includes(id)) : hold.seatIds;
  const released = ids.length
    ? await seatLock.release(hold.showtimeId, ids, `${userId}:${holdToken}`) : 0;
  const remaining = hold.seatIds.filter((id) => !ids.includes(id));
  if (remaining.length === 0) await redis.del(holdKey(holdToken));
  else await redis.hset(holdKey(holdToken), 'seatIds', JSON.stringify(remaining));

  if (released > 0) realtime.toShowtime(hold.showtimeId, 'seats_released', { seatIds: ids });
  return { holdToken: remaining.length ? holdToken : null, seatIds: remaining, expiresAt: hold.expiresAt };
}

async function markPaying(holdToken) {
  await redis.hset(holdKey(holdToken), 'paying', '1');
}

module.exports = { holdSeats, releaseSeats, getHold, markPaying, holdKey };
