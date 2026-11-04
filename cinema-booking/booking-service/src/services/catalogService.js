// Phim, suất chiếu, sơ đồ ghế.
const { pool } = require('../infra/db');
const { redis } = require('../infra/redis');
const { createSeatLock, SOLD } = require('./seatLock');
const { HttpError } = require('../errors');

const seatLock = createSeatLock(redis);
const VIP_SURCHARGE = 20000;

// Thông tin suất chiếu + ghế không đổi → cache trong bộ nhớ mỗi server.
// (Server vẫn "stateless": cache chỉ là bản sao dữ liệu tĩnh, mất đi không sao.)
const showtimeCache = new Map();

async function getShowtime(showtimeId) {
  if (showtimeCache.has(showtimeId)) return showtimeCache.get(showtimeId);
  const { rows } = await pool.query(
    `SELECT s.id, s.start_at, s.price, s.room_id, r.name AS room_name, r.rows, r.cols,
            m.id AS movie_id, m.title, m.genre, m.duration_min
       FROM showtimes s JOIN rooms r ON r.id = s.room_id JOIN movies m ON m.id = s.movie_id
      WHERE s.id = $1`, [showtimeId]);
  if (rows.length === 0) return null;
  const seats = (await pool.query(
    'SELECT id, row_label, col_no, type FROM seats WHERE room_id = $1 ORDER BY row_label, col_no',
    [rows[0].room_id])).rows;
  const st = {
    ...rows[0],
    seats,
    seatById: new Map(seats.map((s) => [s.id, s])),
  };
  showtimeCache.set(showtimeId, st);
  return st;
}

const seatLabel = (seat) => `${seat.row_label}${seat.col_no}`;
const seatPrice = (st, seat) => st.price + (seat.type === 'vip' ? VIP_SURCHARGE : 0);

async function listMovies() {
  const { rows } = await pool.query('SELECT * FROM movies ORDER BY id');
  return rows;
}

async function listShowtimes(movieId) {
  const { rows } = await pool.query(
    `SELECT s.id, s.start_at, s.price, r.name AS room_name
       FROM showtimes s JOIN rooms r ON r.id = s.room_id
      WHERE s.movie_id = $1 ORDER BY s.start_at`, [movieId]);
  return rows;
}

/** Sơ đồ ghế: gộp trạng thái thật từ PostgreSQL (đã bán) và Redis (đang giữ). */
async function seatMap(showtimeId) {
  const st = await getShowtime(showtimeId);
  if (!st) throw new HttpError(404, 'Không tìm thấy suất chiếu');
  const sold = new Set((await pool.query(
    'SELECT seat_id FROM tickets WHERE showtime_id = $1', [showtimeId])).rows.map((r) => r.seat_id));
  const states = await seatLock.states(showtimeId, st.seats.map((s) => s.id));
  return {
    showtime: {
      id: st.id, startAt: st.start_at, price: st.price, vipPrice: st.price + VIP_SURCHARGE,
      room: st.room_name, rows: st.rows, cols: st.cols,
      movie: { id: st.movie_id, title: st.title, genre: st.genre, durationMin: st.duration_min },
    },
    seats: st.seats.map((s) => {
      const v = states.get(s.id);
      let status = 'free';
      let holder = null;
      if (sold.has(s.id) || v === SOLD) status = 'sold';
      else if (v) { status = 'held'; holder = v.split(':')[0]; }
      return { id: s.id, label: seatLabel(s), row: s.row_label, col: s.col_no, type: s.type, status, holder };
    }),
  };
}

module.exports = { getShowtime, listMovies, listShowtimes, seatMap, seatLabel, seatPrice, seatLock };
