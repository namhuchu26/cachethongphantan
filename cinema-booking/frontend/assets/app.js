// Hàm dùng chung cho mọi trang.
const App = {
  get token() { return localStorage.getItem('token'); },
  get userId() { return localStorage.getItem('userId'); },
  lastServer: null,

  /** Gọi REST API qua Nginx. Ghi lại server nào đã trả lời (header X-Served-By). */
  async api(path, { method = 'GET', body, headers = {} } = {}) {
    const h = { ...headers };
    if (body !== undefined) h['Content-Type'] = 'application/json';
    if (this.token) h.Authorization = `Bearer ${this.token}`;
    const res = await fetch(`/api${path}`, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
    this.lastServer = res.headers.get('X-Served-By');
    document.dispatchEvent(new CustomEvent('served', { detail: this.lastServer }));
    const data = res.status === 204 ? null : await res.json().catch(() => null);
    if (!res.ok) {
      const err = new Error((data && data.error) || `Lỗi ${res.status}`);
      err.status = res.status;
      err.data = data;
      if (res.status === 401) this.logout(false);
      throw err;
    }
    return data;
  },

  async login(name) {
    const { token, userId } = await this.api('/auth/login', { method: 'POST', body: { name } });
    localStorage.setItem('token', token);
    localStorage.setItem('userId', userId);
  },

  logout(reload = true) {
    localStorage.removeItem('token');
    localStorage.removeItem('userId');
    if (reload) location.reload();
  },

  /** Kết nối Socket.IO. Chỉ dùng WebSocket nên Nginx chia cho server nào cũng được. */
  socket() {
    return io({ transports: ['websocket'], auth: { token: this.token } });
  },

  money: (n) => `${Number(n).toLocaleString('vi-VN')} đ`,
  time: (d) => new Date(d).toLocaleString('vi-VN', { weekday: 'short', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }),
  esc: (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])),

  /** Thanh tiêu đề: tên người dùng + server vừa trả lời */
  header() {
    const el = document.createElement('header');
    el.className = 'top';
    el.innerHTML = `
      <span class="brand">🎬 CinemaDS</span>
      <nav><a href="/index.html">Phim</a><a href="/dashboard.html">Dashboard</a></nav>
      <span class="spacer"></span>
      <span class="badge" id="served">API: –</span>
      ${this.userId ? `<span>👤 ${this.esc(this.userId)}</span><button class="secondary" id="logout">Đăng xuất</button>` : ''}`;
    document.body.prepend(el);
    el.querySelector('#logout')?.addEventListener('click', () => this.logout());
    document.addEventListener('served', (e) => {
      if (e.detail) el.querySelector('#served').textContent = `API trả lời bởi: ${e.detail}`;
    });
  },
};
