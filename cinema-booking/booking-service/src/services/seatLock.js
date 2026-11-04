// KHÓA GHẾ PHÂN TÁN – trái tim của đề tài.
//
// Mỗi ghế của một suất chiếu là một key trên Redis:
//   seat:{showtimeId}:{seatId} = "{userId}:{holdToken}"  (có TTL)  → đang giữ
//   seat:{showtimeId}:{seatId} = "SOLD"                   (không TTL) → đã bán
//   không có key                                                     → trống
//
// Các thao tác được viết bằng Lua: Redis chạy nguyên cả script như MỘT lệnh,
// nên không server nào chen vào giữa được (loại trừ tương hỗ).

const SOLD = 'SOLD';

const seatKey = (showtimeId, seatId) => `seat:${showtimeId}:${seatId}`;

// Giữ TẤT CẢ ghế hoặc KHÔNG giữ ghế nào. Trả về 0 nếu thành công,
// ngược lại trả về vị trí (1-based) của ghế đầu tiên đã có người giữ/đã bán.
const HOLD_SCRIPT = `
for i, key in ipairs(KEYS) do
  if redis.call('EXISTS', key) == 1 then return i end
end
for i, key in ipairs(KEYS) do
  redis.call('SET', key, ARGV[1], 'EX', ARGV[2])
end
return 0`;

// Chỉ xóa key nếu nó vẫn thuộc về đúng lượt giữ này (không nhả nhầm của người khác).
const RELEASE_SCRIPT = `
local n = 0
for i, key in ipairs(KEYS) do
  if redis.call('GET', key) == ARGV[1] then
    redis.call('DEL', key)
    n = n + 1
  end
end
return n`;

// Kiểm tra mọi ghế vẫn thuộc lượt giữ này, rồi gia hạn thêm ARGV[2] giây.
// Trả về 1 nếu hợp lệ, 0 nếu có ghế đã hết hạn hoặc bị người khác giữ.
const VERIFY_EXTEND_SCRIPT = `
for i, key in ipairs(KEYS) do
  if redis.call('GET', key) ~= ARGV[1] then return 0 end
end
for i, key in ipairs(KEYS) do
  local ttl = redis.call('TTL', key)
  if ttl < 0 then ttl = 0 end
  redis.call('EXPIRE', key, ttl + tonumber(ARGV[2]))
end
return 1`;

// Đánh dấu đã bán: bỏ TTL, giá trị SOLD.
const MARK_SOLD_SCRIPT = `
for i, key in ipairs(KEYS) do
  redis.call('SET', key, 'SOLD')
end
return 1`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function createSeatLock(redis) {
  redis.defineCommand('seatHold', { lua: HOLD_SCRIPT });
  redis.defineCommand('seatRelease', { lua: RELEASE_SCRIPT });
  redis.defineCommand('seatVerifyExtend', { lua: VERIFY_EXTEND_SCRIPT });
  redis.defineCommand('seatMarkSold', { lua: MARK_SOLD_SCRIPT });

  const keysOf = (showtimeId, seatIds) => seatIds.map((id) => seatKey(showtimeId, id));

  return {
    /** Giữ ghế AN TOÀN (nguyên tử). Trả về { ok, conflictSeatId } */
    async hold(showtimeId, seatIds, value, ttlSeconds) {
      const keys = keysOf(showtimeId, seatIds);
      const res = await redis.seatHold(keys.length, ...keys, value, ttlSeconds);
      return res === 0 ? { ok: true } : { ok: false, conflictSeatId: seatIds[res - 1] };
    },

    /**
     * Giữ ghế KHÔNG AN TOÀN – chỉ dùng để DEMO lỗi race condition khi "tắt khóa".
     * Kiểm tra (GET) rồi mới ghi (SET) bằng 2 bước tách rời: giữa 2 bước, server khác
     * vẫn kịp đọc thấy "trống" → hai người cùng giữ được một ghế.
     */
    async holdUnsafe(showtimeId, seatIds, value, ttlSeconds) {
      const keys = keysOf(showtimeId, seatIds);
      const current = await redis.mget(keys);
      const idx = current.findIndex((v) => v !== null);
      if (idx >= 0) return { ok: false, conflictSeatId: seatIds[idx] };
      await sleep(5 + Math.random() * 30); // mô phỏng thời gian xử lý (vd. gọi DB)
      const pipe = redis.pipeline();
      keys.forEach((k) => pipe.set(k, value, 'EX', ttlSeconds));
      await pipe.exec();
      return { ok: true };
    },

    async release(showtimeId, seatIds, value) {
      const keys = keysOf(showtimeId, seatIds);
      return redis.seatRelease(keys.length, ...keys, value);
    },

    async verifyAndExtend(showtimeId, seatIds, value, extraSeconds) {
      const keys = keysOf(showtimeId, seatIds);
      return (await redis.seatVerifyExtend(keys.length, ...keys, value, extraSeconds)) === 1;
    },

    async markSold(showtimeId, seatIds) {
      const keys = keysOf(showtimeId, seatIds);
      return redis.seatMarkSold(keys.length, ...keys);
    },

    /** Đọc trạng thái nhiều ghế: Map seatId → null | 'SOLD' | userId */
    async states(showtimeId, seatIds) {
      if (seatIds.length === 0) return new Map();
      const values = await redis.mget(keysOf(showtimeId, seatIds));
      return new Map(seatIds.map((id, i) => [id, values[i]]));
    },
  };
}

module.exports = { createSeatLock, seatKey, SOLD };
