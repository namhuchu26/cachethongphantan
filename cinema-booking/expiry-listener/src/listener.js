// EXPIRY LISTENER
// Redis được bật "notify-keyspace-events Ex": mỗi khi một key hết hạn, Redis phát tin
// lên kênh __keyevent@0__:expired. Tiến trình này nghe kênh đó; khi khóa ghế
// seat:{showtimeId}:{seatId} hết hạn, nó báo cho mọi trình duyệt đổi ghế về màu xám.
//
// Đây cũng là cơ chế chịu lỗi: Booking Server chết ngay sau khi giữ ghế thì không ai
// phải dọn dẹp – Redis tự xóa khóa khi hết TTL, listener báo cho mọi người.
const Redis = require('ioredis');
const { Emitter } = require('@socket.io/redis-emitter');

const url = process.env.REDIS_URL || 'redis://localhost:6380';
const sub = new Redis(url);         // kết nối ở chế độ subscribe chỉ dùng để nghe
const pub = new Redis(url);         // kết nối thường để phát sự kiện Socket.IO
const emitter = new Emitter(pub);

const CHANNEL = '__keyevent@0__:expired';
const pending = new Map();          // gom các ghế hết hạn cùng lúc thành một sự kiện

function flush() {
  for (const [showtimeId, seatIds] of pending) {
    emitter.to(`showtime:${showtimeId}`).emit('seats_released', {
      showtimeId, seatIds: [...seatIds], by: 'expiry-listener', reason: 'expired',
    });
    console.log(`${new Date().toISOString()} [expired] suất ${showtimeId}: ghế ${[...seatIds].join(',')}`);
  }
  pending.clear();
}

sub.subscribe(CHANNEL, (err) => {
  if (err) { console.error(err); process.exit(1); }
  console.log(`[expiry-listener] đang nghe ${CHANNEL}`);
});

sub.on('message', (_channel, key) => {
  const m = /^seat:(\d+):(\d+)$/.exec(key);
  if (!m) return;
  const showtimeId = Number(m[1]);
  if (!pending.has(showtimeId)) pending.set(showtimeId, new Set());
  pending.get(showtimeId).add(Number(m[2]));
  setTimeout(flush, 100);
});

for (const c of [sub, pub]) c.on('error', (e) => console.error('[redis]', e.message));
process.on('SIGTERM', () => process.exit(0));
