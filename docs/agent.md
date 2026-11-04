# agent.md – Nhật ký dự án

File này ghi lại mọi thứ đã làm trong dự án, để lần sau mở ra là biết ngay đang ở đâu, đã xong gì, còn gì.
**Quy ước:** mỗi lần làm thêm việc gì, thêm một mục vào phần "Nhật ký" (mới nhất ở trên) và cập nhật phần "Trạng thái".

---

## 1. Thông tin chung

| Mục | Nội dung |
| --- | --- |
| Môn học | Các hệ thống phân tán (giáo trình *Distributed Systems* 4th ed., van Steen & Tanenbaum – file `Distributed_Systems_4.pdf`) |
| Đề tài | Hệ thống đặt vé xem phim phân tán chống đặt trùng ghế |
| Ngôn ngữ | Node.js (đã so sánh với Python, Java; chọn Node.js vì mạnh về realtime/Socket.IO và I/O đồng thời) |
| Thư mục làm việc | `D:\phantan\demo` |
| Tài liệu đề tài (online, sửa được) | https://claude.ai/artifact/E8NSMfEt6rjUqYzb1JnWdK |

## 2. Các file trong `D:\phantan\demo`

| File / thư mục | Nội dung |
| --- | --- |
| `Distributed_Systems_4.pdf` | Giáo trình (có sẵn) |
| `detai.docx` | Mô tả đề tài chi tiết bằng Word (13 mục: tổng quan, khái niệm, mục tiêu, yêu cầu + kết quả đo, kiến trúc, dữ liệu, luồng xử lý, API, công nghệ, demo + kết quả, liên hệ môn học, kế hoạch, rủi ro + câu hỏi bảo vệ, khác biệt thiết kế/cài đặt). Định dạng `.docx` (Word 2007+), không phải `.doc` cũ. **Đã khớp với code** (cập nhật 03/11/2026). |
| `detai.md` | Bản nguồn Markdown của `detai.docx`. Sửa file này rồi chạy `python tools/md2docx.py detai.md detai.docx` để tạo lại Word (đóng Word trước khi chạy). |
| `tools/md2docx.py` | Script chuyển Markdown → Word (cần `pip install python-docx`); hỗ trợ chèn ảnh `![chú thích](docs/x.png)` |
| `docs/so-do-du-an.drawio` | File **draw.io** 3 trang: (1) Lưu đồ đặt vé – flowchart có điều kiện rẽ nhánh, (2) Luồng người dùng qua các màn hình, (3) Kiến trúc. Mở bằng https://app.diagrams.net hoặc extension "Draw.io Integration" trong VS Code. |
| `docs/` | Ảnh sơ đồ: `kien-truc.png` (kiến trúc), `flow-dat-ve.png` (flow 21 bước của một lượt đặt vé), `trang-thai-ghe.png` (vòng đời ghế). Bản gốc sửa được nằm trong tài liệu online. |
| `cinema-booking/` | Mã nguồn dự án – xem `cinema-booking/README.md` để chạy |
| `agent.md` | File này |

## 3. Trạng thái hiện tại

**Đã chạy được toàn bộ hệ thống và đã kiểm thử (03/11/2026).**

- [x] Chọn đề tài, viết tài liệu đề tài (Claude Doc + `detai.docx`)
- [x] Hạ tầng Docker Compose: 9 container (nginx, 3 booking, redis, postgres, rabbitmq, payment-worker, expiry-listener)
- [x] Database schema + dữ liệu mẫu (3 phim, 2 phòng: 100 và 96 ghế, 6 suất chiếu)
- [x] Khóa ghế phân tán bằng Lua script trên Redis (giữ / nhả / gia hạn / đánh dấu đã bán) + chế độ "tắt khóa" để demo lỗi
- [x] REST API đầy đủ + JWT + header `X-Served-By`
- [x] Thanh toán bất đồng bộ qua RabbitMQ: durable queue, ACK thủ công, retry 3 lần, dead-letter queue, idempotency
- [x] Realtime: Socket.IO + Redis adapter (giữa các server) + Redis emitter (từ worker/listener)
- [x] Expiry Listener: ghế hết hạn tự báo về trống
- [x] Frontend: trang phim, sơ đồ ghế (đếm ngược, thanh toán, vé), dashboard demo
- [x] **Bấm ghế là giữ ngay** + chọn nhiều ghế gộp vào một lượt giữ (tối đa 8), bấm lại để bỏ từng ghế; khách khác thấy tức thì
- [x] Tài liệu đề tài (Claude Doc + `detai.docx`) đã cập nhật khớp code, thêm mục 13 "Khác biệt thiết kế/cài đặt"
- [x] Script kiểm thử tải `loadtest/rush.js`
- [x] 8 unit test cho khóa ghế – pass
- [ ] Viết báo cáo cuối kỳ (dùng `detai.docx` làm khung, thêm số liệu đo ở mục 4)
- [ ] Làm slide thuyết trình
- [ ] Tập demo trên máy sẽ dùng khi bảo vệ
- [ ] (Tùy chọn, điểm cộng) Redis Sentinel/Redlock, bầu leader cho worker, Saga, Prometheus + Grafana

## 4. Kết quả kiểm thử đã đo (máy hiện tại, 03/11/2026)

| Kịch bản | Kết quả |
| --- | --- |
| Luồng đặt vé cơ bản | Giữ ghế 201 → người khác giữ trùng 409 → thanh toán 202 → Worker ghi vé → PAID, có mã vé; ghế đã bán giữ lại bị 409; nhả ghế của người khác bị 403 |
| D2 – 5.000 request vào 100 ghế, 200 đồng thời, **BẬT khóa** | 201 = 100, 409 = 4.900, **0 ghế trùng**, ~1.050 request/giây, p50/p95 ≈ 170/370 ms, chia tải đều 1.667 request/server |
| D2 – như trên, **TẮT khóa** | 201 = 170 trên 100 ghế, **51 ghế bị giữ trùng** → chứng minh race condition |
| D4 – `docker stop booking-2` | 12/12 request vẫn 200; dashboard báo booking-2 CHẾT; bật lại thì SỐNG |
| D5 – tắt worker rồi thanh toán | Đơn PENDING, hàng đợi pending = 1, consumers = 0; bật worker → PAID, hàng đợi về 0 |
| D3 – TTL 10 giây | Ghế held → sau 12 giây free; expiry-listener log "[expired] suất 3: ghế 60" |
| D6 – idempotency | 2 request cùng `Idempotency-Key` → cùng 1 booking id (`duplicate: true` ở lần 2) |
| Realtime | 4 client nối vào booking-1/2/3 đều nhận `seats_held` (từ booking-1) và `seats_sold` (từ payment-worker) |
| Unit test | 8/8 pass (`docker compose exec booking-1 npm test`) |

## 5. Quyết định thiết kế & khác biệt so với thiết kế ban đầu

Các điểm dưới đây khác thiết kế ban đầu. **Tài liệu đề tài đã được sửa cho khớp** (mục 13 của `detai.docx` liệt kê lại dạng bảng).

0. **Bấm ghế là giữ ngay (không còn nút "Giữ ghế").** Mỗi người có một lượt giữ (`holdToken`) cho mỗi suất chiếu, giống giỏ hàng: bấm thêm ghế → `POST /holds` kèm `holdToken` → ghế mới khóa cùng giá trị, TTL = thời gian còn lại, nên cả lượt hết hạn cùng lúc. Bấm lại ghế của mình → `DELETE /holds/:token/seats/:seatId`. Trình duyệt xếp hàng các lần bấm (không gửi song song) để mọi ghế vào đúng một lượt giữ. Khi đã thanh toán, hash `hold:{token}` có `paying=1` → không thêm/bớt ghế được.
1. **Đơn hàng được tạo ở Booking Server (PENDING), không phải ở Worker.** Lý do: client cần `bookingId` ngay để theo dõi. Worker chỉ chuyển PENDING → PAID/FAILED và ghi vé. Idempotency nằm ở 2 chỗ: API (`idempotency_key` UNIQUE) và Worker (bỏ qua đơn không còn PENDING, `SELECT … FOR UPDATE`).
2. **Ghế đã bán lưu trên Redis là `SOLD` (không TTL)**, đồng thời API giữ ghế luôn kiểm tra bảng `tickets` trong PostgreSQL trước → Redis mất dữ liệu cũng không bán trùng.
3. **Nginx dùng round-robin cho cả WebSocket, không dùng `ip_hash`.** Client Socket.IO chỉ dùng transport `websocket` nên không cần sticky session; nhờ vậy 2 trình duyệt trên cùng máy vẫn vào 2 server khác nhau (demo D1 đẹp hơn).
4. **Kiểm thử tải dùng script Node (`loadtest/rush.js`) thay vì k6** – không phải cài thêm gì.
5. **Không dùng thư viện `zod`**, kiểm tra dữ liệu vào viết tay. **Chưa làm mã QR** (chỉ có mã đặt vé dạng chữ).
6. Thời gian giữ ghế và bật/tắt khóa lưu trên Redis (`config:hold_ttl`, `config:lock_enabled`) → đổi lúc chạy từ dashboard, áp dụng cho mọi server.
7. Dashboard biết server sống/chết nhờ **nhịp tim**: mỗi server ghi `server:{tên}` lên Redis 2 giây/lần, TTL 6 giây.
8. Cổng trên máy host được đổi để không đụng `D:\phantan\docker-compose.yml` cũ (RabbitMQ 5672/15672, Kafka): web 8080, RabbitMQ UI 15673, Postgres 5433, Redis 6380.

## 6. Lỗi đã gặp và cách sửa

| Lỗi | Nguyên nhân | Cách sửa |
| --- | --- | --- |
| Booking Server khởi động lại vài lần lúc đầu (`ECONNREFUSED :5672`) | RabbitMQ báo healthy trước khi cổng AMQP mở | Thêm vòng thử kết nối lại (tối đa 30 lần × 2 giây) trong `booking-service/src/infra/mq.js` |
| Kiểm thử tải: hàng nghìn lỗi 502 "no live upstreams" | Vài kết nối bị reset dưới tải; Nginx `max_fails=1` nên đánh dấu cả 3 server chết | Nginx: `keepalive 64` + HTTP/1.1 tới upstream, `max_fails=3`; Node: `keepAliveTimeout = 65s` (lớn hơn của Nginx) |
| Tưởng khóa lỗi (18 ghế trùng khi "bật khóa") | Lệnh bật lại khóa ở lần chạy trước bị 502 nên khóa vẫn TẮT | Không phải lỗi code; script in rõ trạng thái khóa ở dòng đầu – luôn kiểm tra dòng đó |
| Người dùng báo: không chọn được nhiều ghế; khách khác không thấy ghế đang chọn | Thiết kế cũ: chọn ghế chỉ lưu ở trình duyệt, phải bấm "Giữ ghế" mới gửi lên server; đã giữ thì khóa không cho chọn thêm | Đổi sang "bấm là giữ" + gộp nhiều ghế vào một lượt giữ (xem mục 5, điểm 0) |
| Khóa phân tán bị TẮT khi kiểm thử lại | Bật/tắt trên dashboard được lưu trên Redis, giữ nguyên cho tới khi đổi lại | Trước khi demo/kiểm thử luôn xem trạng thái khóa trên dashboard |

## 7. Cách tiếp tục lần sau

1. Mở Docker Desktop (nằm ở `C:\Users\Admin\AppData\Local\Programs\DockerDesktop\Docker Desktop.exe`).
2. `cd D:\phantan\demo\cinema-booking` → `docker compose up -d` → mở http://localhost:8080.
3. Đọc `cinema-booking/README.md` mục "Kịch bản demo".
4. Việc tiếp theo nên làm: báo cáo + slide (xem mục 3).

---

## Nhật ký

### 04/11/2026 (lần 9)
- Viết `sodo.md` → `sodo.docx`: diễn giải 3 sơ đồ trong `docs/so-do-du-an.drawio` (cách đọc, từng bước theo làn, 4 đường quay lại, các thành phần và kết nối, ý nghĩa với môn học). Tạo lại: `python tools/md2docx.py sodo.md sodo.docx`.
- Sửa `tools/md2docx.py`: danh sách đánh số giữ đúng số đã viết, vì kiểu List Number của Word đánh số nối tiếp trong cả file.

### 04/11/2026 (lần 8)
- Viết tài liệu **kịch bản thuyết trình demo** trên Claude Docs: https://claude.ai/artifact/7DFeKM7Kh3RzxKMmkLohp4. Gồm chuẩn bị trước buổi demo, mở đầu + sơ đồ kiến trúc, D1–D6 (thao tác / lời nói mẫu / điểm hệ phân tán), câu hỏi hay gặp, kết luận, bảng xử lý sự cố.

### 04/11/2026 (lần 7)
- Người dùng thấy bản lần 6 sơ sài → bổ sung, vẫn giữ đen trắng + chiều ngang:
  - Trang 1 chia **5 làn** (Trình duyệt / Booking Server / Redis / RabbitMQ + Worker / PostgreSQL), bước nằm ở làn của thành phần chạy nó. Thêm: Lua khóa nguyên khối, Pub/Sub báo mọi trình duyệt, chọn thêm/bỏ ghế (tối đa 8), Idempotency-Key, kiểm tra + gia hạn lượt giữ, Expiry Listener, đơn PENDING, hàng đợi payments, UNIQUE, thử lại 3 lần → DLQ. 4 đường "chọn lại" chạy phía trên cùng.
  - Trang 3 tách mũi tên có nhãn: HTTP + WebSocket, chia đều, khóa ghế/Pub/Sub/nhịp tim, đọc phim/ghi đơn, gửi job, khóa hết hạn, lấy job/ACK, ghi vé.
  - Trang 2 giữ nguyên.

### 03/11/2026 (lần 6)
- Vẽ lại `docs/so-do-du-an.drawio` theo yêu cầu: **đơn giản, đen trắng, chiều ngang (trái → phải)**. Trang 1 lưu đồ (13 bước hàng chính + 3 nhánh lỗi bên dưới quay về "Bấm chọn ghế", vòng "Chọn thêm ghế" phía trên); trang 2 luồng người dùng (7 màn hình + Dashboard + ghi chú thao tác); trang 3 kiến trúc.
- Script sinh file: `tools/make_drawio.py` (sửa chữ / vị trí trong script rồi chạy `python tools/make_drawio.py docs/so-do-du-an.drawio`, hoặc sửa trực tiếp trong draw.io).

### 03/11/2026 (lần 5)
- Tạo `docs/so-do-du-an.drawio` (3 trang): **Lưu đồ đặt vé** (29 hình: bắt đầu → đăng nhập → chọn ghế → 5 điều kiện rẽ nhánh: đã đăng nhập?, ghế còn trống?, chọn thêm?, thanh toán kịp?, trùng Idempotency-Key?, ghi vé thành công? → kết thúc), **Luồng người dùng** (màn hình đăng nhập, danh sách phim, chọn ghế, đang xử lý, vé, dashboard + các thao tác), **Kiến trúc**.
- Máy chưa có draw.io desktop / extension VS Code → chưa xuất PNG của các trang này; mở bằng app.diagrams.net rồi File → Export as → PNG.

### 03/11/2026 (lần 4)
- Vẽ sơ đồ **flow một lượt đặt vé** (sequence diagram: 7 thành phần Khách A, Booking, Redis, Postgres, RabbitMQ, Worker, Khách B; 21 bước, 5 giai đoạn) – thêm vào đầu mục 6 tài liệu online.
- Xuất 3 sơ đồ ra ảnh `docs/*.png`; `detai.docx` giờ dùng ảnh thật (Hình 1 kiến trúc, Hình 2 flow, Hình 3 vòng đời ghế) thay cho hình ASCII; README hiển thị ảnh kiến trúc + flow.

### 03/11/2026 (lần 3)
- Giao diện: bỏ khung "Sự kiện realtime" ở trang chọn ghế (`seats.html`); chỉ giữ dòng nhỏ "WebSocket nối với: …" trong khung "Vé của bạn" (cần cho demo D1, D4).
- Dashboard: nhật ký sự kiện realtime giờ ghi tên ghế (vd. "booking-2 An giữ F7, F8", "nhả F10 (hết thời gian giữ)"), báo mất kết nối WebSocket, tự ẩn bớt khi bắn tải quá nhiều sự kiện.
- Giải thích chi tiết D4, D5, D6 cho người dùng (cơ chế, dòng thời gian, liên hệ chương 4 và 8, giới hạn) – có thể dùng lại cho báo cáo.

### 03/11/2026 (lần 2)
- Sửa theo phản hồi: **bấm ghế là giữ ngay**, chọn được nhiều ghế (gộp vào một lượt giữ, tối đa 8), bấm lại để bỏ từng ghế; khách khác thấy ghế chuyển vàng tức thì.
  - Server: `holdService.js` viết lại (gộp ghế theo `holdToken`, nhả từng ghế, cờ `paying`), route mới `DELETE /api/holds/:token/seats/:seatId`, `bookingService.js` gọi `markPaying`.
  - Frontend: `seats.html` viết lại (bỏ nút "Giữ ghế", hàng đợi thao tác, nút "Bỏ chọn tất cả").
  - Đã kiểm thử: 3 lần bấm do 3 server khác nhau xử lý vẫn cùng một lượt giữ; người xem khác nhận `seats_held` từng ghế; bỏ 1 ghế → người khác giữ được ngay; đang thanh toán thêm ghế → 409; thanh toán 2 ghế → PAID. Unit test 8/8, tải 5.000 request (bật khóa) → 0 trùng.
- Cập nhật tài liệu đề tài cho khớp code (Claude Doc + `detai.docx`): mục 2, 3 (thêm cột kết quả đo), 4, 5, 6, 7, 8, 9 (thêm bảng kết quả), 11, thêm mục 13 "Khác biệt giữa thiết kế ban đầu và bản cài đặt". Lưu bản nguồn `detai.md` + `tools/md2docx.py`.

### 03/11/2026
- Tìm hiểu môn học từ mục lục giáo trình (9 chương), giải thích ý nghĩa môn, liệt kê 13 đề tài tham khảo kèm độ khó/thời gian/độ khó trình bày.
- Chốt đề tài: **đặt vé xem phim phân tán chống đặt trùng ghế**, ngôn ngữ **Node.js**.
- Viết tài liệu đề tài chi tiết (Claude Doc, có sơ đồ kiến trúc + sơ đồ trạng thái ghế + code mẫu), xuất ra `detai.docx`.
- Dựng toàn bộ dự án `cinema-booking/` (khoảng 25 file), chạy bằng Docker Compose.
- Kiểm thử: luồng đặt vé, D2 (bật/tắt khóa), D3, D4, D5, D6, realtime giữa các server, 8 unit test – tất cả đạt (số liệu ở mục 4).
- Sửa 2 lỗi hạ tầng (mục 6).
