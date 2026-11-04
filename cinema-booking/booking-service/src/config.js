// Cấu hình đọc từ biến môi trường (xem docker-compose.yml)
module.exports = {
  port: Number(process.env.PORT || 3000),
  serverName: process.env.SERVER_NAME || 'booking-local',
  redisUrl: process.env.REDIS_URL || 'redis://localhost:6380',
  databaseUrl: process.env.DATABASE_URL || 'postgres://cinema:cinema@localhost:5433/cinema',
  amqpUrl: process.env.AMQP_URL || 'amqp://cinema:cinema@localhost:5672',
  jwtSecret: process.env.JWT_SECRET || 'dev-secret',
  defaultHoldTtl: Number(process.env.HOLD_TTL_SECONDS || 300),
  maxSeatsPerHold: 8,
  paymentExtendSeconds: 120, // gia hạn khóa khi bắt đầu thanh toán
};
