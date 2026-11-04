// KIỂM THỬ TẢI: nhiều người cùng tranh ghế của một suất chiếu (kịch bản D2).
// Không cần cài gì thêm, chỉ cần Node 18+:
//
//   node loadtest/rush.js                       # 5.000 request, 200 đồng thời, suất 1
//   node loadtest/rush.js --requests 2000 --concurrency 100 --showtime 1 --no-reset
//
// Mỗi request: một người ngẫu nhiên giữ một ghế ngẫu nhiên trong 100 ghế.
// Kết quả đúng khi BẬT khóa: đúng 100 lượt giữ thành công (mỗi ghế 1 lần), 0 ghế trùng.
// Khi TẮT khóa (dashboard): số lượt "thành công" > 100 → nhiều người cùng giữ một ghế.

const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : def;
};
const BASE = opt('base', 'http://localhost:8080');
const SHOWTIME = Number(opt('showtime', 1));
const REQUESTS = Number(opt('requests', 5000));
const CONCURRENCY = Number(opt('concurrency', 200));
const USERS = Number(opt('users', 300));
const RESET = !args.includes('--no-reset');

async function call(path, { method = 'GET', body, token } = {}) {
  const res = await fetch(`${BASE}/api${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => null);
  return { status: res.status, data, server: res.headers.get('x-served-by') };
}

const percentile = (arr, p) => {
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))] ?? 0;
};

async function main() {
  const stats = (await call('/admin/stats')).data;
  console.log(`\nKhóa phân tán: ${stats.settings.lockEnabled ? 'BẬT' : 'TẮT'}  |  server sống: ${stats.servers.filter((s) => s.alive).map((s) => s.name).join(', ')}`);

  if (RESET) {
    await call('/admin/reset', { method: 'POST', body: { showtimeId: SHOWTIME } });
    console.log(`Đã reset suất chiếu ${SHOWTIME}`);
  }
  const seatIds = (await call(`/showtimes/${SHOWTIME}/seats`)).data.seats
    .filter((s) => s.status === 'free').map((s) => s.id);
  console.log(`Ghế trống: ${seatIds.length}. Đăng nhập ${USERS} người dùng…`);

  const tokens = [];
  for (let i = 0; i < USERS; i++) {
    tokens.push((await call('/auth/login', { method: 'POST', body: { name: `khach${i}` } })).data.token);
  }

  console.log(`Bắn ${REQUESTS} request giữ ghế, ${CONCURRENCY} request đồng thời…\n`);
  const winnersBySeat = new Map();
  const byStatus = {};
  const byServer = {};
  const latencies = [];
  let next = 0;
  const started = Date.now();

  async function worker() {
    while (next < REQUESTS) {
      next++;
      const seatId = seatIds[Math.floor(Math.random() * seatIds.length)];
      const token = tokens[Math.floor(Math.random() * tokens.length)];
      const t0 = performance.now();
      let r;
      try {
        r = await call(`/showtimes/${SHOWTIME}/holds`, { method: 'POST', body: { seatIds: [seatId] }, token });
      } catch {
        r = { status: 'network-error', server: null };
      }
      latencies.push(performance.now() - t0);
      byStatus[r.status] = (byStatus[r.status] || 0) + 1;
      if (r.server) byServer[r.server] = (byServer[r.server] || 0) + 1;
      if (r.status === 201) winnersBySeat.set(seatId, (winnersBySeat.get(seatId) || 0) + 1);
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  const secs = (Date.now() - started) / 1000;

  const wins = [...winnersBySeat.values()].reduce((a, b) => a + b, 0);
  const doubled = [...winnersBySeat.values()].filter((n) => n > 1).length;

  console.log('──────────── KẾT QUẢ ────────────');
  console.log(`Thời gian chạy        : ${secs.toFixed(1)} s  (${Math.round(REQUESTS / secs)} request/giây)`);
  console.log(`Độ trễ p50 / p95 / p99 : ${percentile(latencies, 50).toFixed(0)} / ${percentile(latencies, 95).toFixed(0)} / ${percentile(latencies, 99).toFixed(0)} ms`);
  console.log(`Mã trả về             : ${Object.entries(byStatus).map(([k, v]) => `${k}=${v}`).join('  ')}`);
  console.log(`Chia tải theo server  : ${Object.entries(byServer).sort().map(([k, v]) => `${k}=${v}`).join('  ')}`);
  console.log(`Lượt giữ thành công   : ${wins}  trên ${seatIds.length} ghế`);
  console.log(`Ghế bị giữ TRÙNG      : ${doubled}`);
  console.log(doubled === 0
    ? '\n✅ Không có ghế nào bị hai người cùng giữ.'
    : `\n❌ ${doubled} ghế bị nhiều người cùng giữ → lỗi đặt trùng (race condition)!`);
}

main().catch((err) => { console.error('Lỗi:', err.message); process.exit(1); });
