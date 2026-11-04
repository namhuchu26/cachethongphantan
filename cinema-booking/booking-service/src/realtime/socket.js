// Socket.IO + Redis adapter.
// Mỗi người xem có thể kết nối vào một server khác nhau. Redis adapter chuyển sự kiện
// giữa các server, nên emit ở server 1 thì client đang nối với server 2, 3 cũng nhận được.
const { Server } = require('socket.io');
const { createAdapter } = require('@socket.io/redis-adapter');
const jwt = require('jsonwebtoken');
const config = require('../config');
const { pubClient, subClient } = require('../infra/redis');

let io = null;

function initRealtime(httpServer) {
  io = new Server(httpServer, { cors: { origin: '*' } });
  io.adapter(createAdapter(pubClient, subClient));

  io.on('connection', (socket) => {
    const token = socket.handshake.auth && socket.handshake.auth.token;
    if (token) {
      try {
        socket.data.userId = jwt.verify(token, config.jwtSecret).sub;
        socket.join(`user:${socket.data.userId}`); // để gửi kết quả đặt vé riêng cho người đó
      } catch { /* khách chưa đăng nhập vẫn xem được sơ đồ ghế */ }
    }
    socket.emit('hello', { server: config.serverName });

    socket.on('join_showtime', (showtimeId) => socket.join(`showtime:${Number(showtimeId)}`));
    socket.on('leave_showtime', (showtimeId) => socket.leave(`showtime:${Number(showtimeId)}`));
  });
  return io;
}

function toShowtime(showtimeId, event, payload) {
  if (io) io.to(`showtime:${showtimeId}`).emit(event, { ...payload, showtimeId, by: config.serverName });
}

module.exports = { initRealtime, toShowtime };
