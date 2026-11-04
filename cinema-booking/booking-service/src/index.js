// Booking Server – chạy 3 bản giống hệt nhau (booking-1, booking-2, booking-3) sau Nginx.
const http = require('http');
const express = require('express');
const config = require('./config');
const { redis } = require('./infra/redis');
const { pool } = require('./infra/db');
const { connectMq } = require('./infra/mq');
const { initRealtime } = require('./realtime/socket');
const { startHeartbeat } = require('./services/adminService');
const routes = require('./routes');

async function main() {
  await pool.query('SELECT 1');
  await connectMq();

  const app = express();
  app.use(express.json());

  // Ghi tên server vào mọi response + đếm số request mỗi server (hiện trên dashboard)
  app.use((req, res, next) => {
    res.set('X-Served-By', config.serverName);
    if (req.path.startsWith('/api/')) redis.incr(`stats:requests:${config.serverName}`).catch(() => {});
    next();
  });

  app.get('/health', (_req, res) => res.json({ ok: true, server: config.serverName }));
  app.use('/api', routes);

  app.use((err, _req, res, _next) => {
    const status = err.status || 500;
    if (status >= 500) console.error(err);
    res.status(status).json({ error: err.message || 'Lỗi máy chủ', ...(err.extra || {}), server: config.serverName });
  });

  const server = http.createServer(app);
  // Phải lớn hơn thời gian Nginx giữ kết nối rảnh (60 giây), nếu không Node đóng kết nối
  // đúng lúc Nginx đang gửi request → lỗi "connection reset"
  server.keepAliveTimeout = 65000;
  server.headersTimeout = 66000;
  initRealtime(server);
  startHeartbeat();
  server.listen(config.port, () => console.log(`[${config.serverName}] listening on :${config.port}`));

  const shutdown = () => {
    console.log(`[${config.serverName}] shutting down`);
    redis.del(`server:${config.serverName}`).finally(() => process.exit(0));
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch((err) => {
  console.error('Startup failed:', err.message);
  process.exit(1);
});
