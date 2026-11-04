// Thanh toán: kiểm tra lượt giữ, tạo đơn PENDING, gửi job vào RabbitMQ (bất đồng bộ).
const { pool } = require('../infra/db');
const { publishPayment } = require('../infra/mq');
const config = require('../config');
const { HttpError } = require('../errors');
const { getShowtime, seatLabel, seatPrice, seatLock } = require('./catalogService');
const { getHold, markPaying } = require('./holdService');

function toDto(b, tickets = []) {
  return {
    id: b.id, status: b.status, showtimeId: b.showtime_id, seatIds: b.seat_ids,
    total: b.total, code: b.code, error: b.error, servedBy: b.served_by,
    createdAt: b.created_at, tickets,
  };
}

async function findByIdempotencyKey(key) {
  const { rows } = await pool.query('SELECT * FROM bookings WHERE idempotency_key = $1', [key]);
  return rows[0] || null;
}

async function createBooking(userId, holdToken, idempotencyKey) {
  if (!idempotencyKey) throw new HttpError(400, 'Thiếu header Idempotency-Key');
  if (!holdToken) throw new HttpError(400, 'Thiếu holdToken');

  // IDEMPOTENCY: gửi lại cùng một key → trả lại đúng đơn cũ, không tạo đơn mới
  const existing = await findByIdempotencyKey(idempotencyKey);
  if (existing) {
    if (existing.user_id !== userId) throw new HttpError(409, 'Idempotency-Key đã được dùng');
    return { booking: toDto(existing), duplicate: true };
  }

  const hold = await getHold(holdToken);
  if (!hold) throw new HttpError(409, 'Hết thời gian giữ ghế, vui lòng chọn lại');
  if (hold.userId !== userId) throw new HttpError(403, 'Không phải ghế bạn đang giữ');

  // Ghế vẫn thuộc về mình? Nếu đúng thì gia hạn để không hết hạn khi Worker đang xử lý.
  const stillMine = await seatLock.verifyAndExtend(
    hold.showtimeId, hold.seatIds, `${userId}:${holdToken}`, config.paymentExtendSeconds);
  if (!stillMine) throw new HttpError(409, 'Hết thời gian giữ ghế, vui lòng chọn lại');

  const st = await getShowtime(hold.showtimeId);
  const total = hold.seatIds.reduce((sum, id) => sum + seatPrice(st, st.seatById.get(id)), 0);

  const ins = await pool.query(
    `INSERT INTO bookings (user_id, showtime_id, seat_ids, hold_token, total, idempotency_key, served_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (idempotency_key) DO NOTHING RETURNING *`,
    [userId, hold.showtimeId, hold.seatIds, holdToken, total, idempotencyKey, config.serverName]);
  if (ins.rowCount === 0) {
    // Hai request cùng key đến gần như đồng thời: request kia đã tạo đơn trước
    return { booking: toDto(await findByIdempotencyKey(idempotencyKey)), duplicate: true };
  }
  const booking = ins.rows[0];
  await markPaying(holdToken); // từ giờ không thêm/bớt ghế trong lượt giữ này được nữa

  try {
    await publishPayment({
      bookingId: booking.id, userId, showtimeId: hold.showtimeId, seatIds: hold.seatIds, holdToken,
    });
  } catch (err) {
    await pool.query(`UPDATE bookings SET status = 'FAILED', error = $2 WHERE id = $1`,
      [booking.id, 'Không gửi được vào hàng đợi']);
    throw new HttpError(503, 'Hệ thống thanh toán đang bận, thử lại sau');
  }
  return { booking: toDto(booking), duplicate: false };
}

async function getBooking(userId, bookingId) {
  const { rows } = await pool.query('SELECT * FROM bookings WHERE id = $1', [bookingId]);
  const b = rows[0];
  if (!b || b.user_id !== userId) throw new HttpError(404, 'Không tìm thấy đơn');
  const st = await getShowtime(b.showtime_id);
  const tickets = (await pool.query('SELECT seat_id FROM tickets WHERE booking_id = $1', [b.id])).rows
    .map((t) => seatLabel(st.seatById.get(t.seat_id)));
  return { ...toDto(b, tickets), movie: st.title, startAt: st.start_at, room: st.room_name };
}

module.exports = { createBooking, getBooking };
