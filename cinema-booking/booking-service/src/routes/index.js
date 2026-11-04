// Toàn bộ REST API. Mọi API đều stateless: server nào trả lời cũng được.
const express = require('express');
const { wrap, HttpError } = require('../errors');
const { requireUser, signToken } = require('../middleware/auth');
const catalog = require('../services/catalogService');
const holds = require('../services/holdService');
const bookings = require('../services/bookingService');
const admin = require('../services/adminService');
const settings = require('../services/settings');

const router = express.Router();

// ---- Đăng nhập ----
router.post('/auth/login', (req, res) => {
  const name = String(req.body?.name || '').trim();
  if (!/^[\p{L}\p{N} _.-]{2,30}$/u.test(name)) throw new HttpError(400, 'Tên dài 2–30 ký tự, không ký tự đặc biệt');
  res.json({ token: signToken(name), userId: name });
});

// ---- Phim, suất chiếu, sơ đồ ghế ----
router.get('/movies', wrap(async (_req, res) => res.json(await catalog.listMovies())));
router.get('/movies/:id/showtimes', wrap(async (req, res) =>
  res.json(await catalog.listShowtimes(Number(req.params.id)))));
router.get('/showtimes/:id/seats', wrap(async (req, res) =>
  res.json(await catalog.seatMap(Number(req.params.id)))));

// ---- Giữ ghế / nhả ghế ----
// body: { seatIds: [...], holdToken?: "..." } – có holdToken thì gộp ghế vào lượt giữ đang có
router.post('/showtimes/:id/holds', requireUser, wrap(async (req, res) =>
  res.status(201).json(await holds.holdSeats(
    req.userId, Number(req.params.id), req.body?.seatIds, req.body?.holdToken))));
// nhả một ghế trong lượt giữ
router.delete('/holds/:token/seats/:seatId', requireUser, wrap(async (req, res) =>
  res.json(await holds.releaseSeats(req.userId, req.params.token, [Number(req.params.seatId)]))));
// nhả tất cả ghế của lượt giữ
router.delete('/holds/:token', requireUser, wrap(async (req, res) =>
  res.json(await holds.releaseSeats(req.userId, req.params.token))));

// ---- Thanh toán ----
router.post('/bookings', requireUser, wrap(async (req, res) => {
  const { booking, duplicate } = await bookings.createBooking(
    req.userId, req.body?.holdToken, req.get('idempotency-key'));
  res.status(202).json({ ...booking, duplicate });
}));
router.get('/bookings/:id', requireUser, wrap(async (req, res) =>
  res.json(await bookings.getBooking(req.userId, req.params.id))));

// ---- Dashboard / demo (không cần đăng nhập cho tiện demo) ----
router.get('/admin/stats', wrap(async (_req, res) => res.json(await admin.getStats())));
router.put('/admin/lock', wrap(async (req, res) => {
  await settings.setLockEnabled(Boolean(req.body?.enabled));
  res.json(await settings.getSettings());
}));
router.put('/admin/hold-ttl', wrap(async (req, res) => {
  const seconds = Number(req.body?.seconds);
  if (!Number.isInteger(seconds) || seconds < 10 || seconds > 3600) throw new HttpError(400, 'TTL từ 10 đến 3600 giây');
  await settings.setHoldTtl(seconds);
  res.json(await settings.getSettings());
}));
router.post('/admin/reset', wrap(async (req, res) =>
  res.json(await admin.resetShowtime(Number(req.body?.showtimeId || 1)))));
router.post('/admin/reset-counters', wrap(async (_req, res) => {
  await admin.resetCounters();
  res.json({ ok: true });
}));

module.exports = router;
