# Đề tài: Hệ thống đặt vé xem phim phân tán chống đặt trùng ghế

Môn: Các hệ thống phân tán · 03/11/2026

## 1. Tổng quan

Hệ thống cho phép hàng nghìn người cùng đặt vé xem phim trên nhiều server, mà mỗi ghế của một suất chiếu chỉ được bán đúng một lần.

**Bối cảnh.** Ngày ra mắt phim bom tấn, lượng truy cập tăng đột biến trong vài phút đầu mở bán. Một server duy nhất sẽ quá tải, và nếu nó sập thì cả rạp ngừng bán vé.

**Giải pháp.** Chạy nhiều Booking Server giống hệt nhau sau một bộ cân bằng tải. Cách này tăng sức chịu tải và tránh điểm chết duy nhất.

**Bài toán cốt lõi.** Khi có nhiều server, hai người ở hai server khác nhau có thể cùng bấm ghế F7 vào cùng một mili giây. Mỗi server chỉ biết trạng thái của chính nó, nên nếu không phối hợp thì cả hai đều báo "đặt thành công". Đây là lỗi **đặt trùng ghế** (double booking), một dạng race condition trong môi trường phân tán.

**Điểm khác với bán vé thông thường.** Vé concert thường chỉ cần "không bán quá số lượng". Vé xem phim khó hơn: người dùng chọn đích danh từng ghế, nên mỗi ghế là một tài nguyên riêng cần loại trừ tương hỗ.

**Hiểu nhanh các khái niệm trước khi đọc tiếp**

Cả đề tài xoay quanh 10 khái niệm dưới đây; hiểu chúng là đọc được toàn bộ phần sau.

| Khái niệm | Nó là gì | Ví dụ đời thường | Dùng ở đâu trong đề tài |
| --- | --- | --- | --- |
| **Load balancer** (Nginx) | Người đứng cửa chia khách cho các quầy | Bảo vệ rạp chỉ khách: "quầy 2 đang trống, mời anh qua đó" | Chia request cho 3 Booking Server, bỏ qua server đã chết |
| **Stateless** | Server không nhớ gì riêng, mọi dữ liệu nằm ở kho chung | Nhân viên quầy nào cũng tra cùng một sổ chung, nên khách đổi quầy không sao | Booking Server; nhờ vậy tắt một server không mất gì |
| **Race condition** | Hai việc chạy cùng lúc, kết quả sai tùy ai nhanh hơn | Hai nhân viên cùng nhìn sổ thấy ghế F7 trống, cùng bán | Lỗi đặt trùng ghế cần chống |
| **Khóa phân tán** (distributed lock) | Một "chìa khóa" chung mà mọi server phải xin trước khi đụng vào tài nguyên | Muốn bán ghế F7 phải cầm được thẻ F7; chỉ có một thẻ | Khóa từng ghế trên Redis |
| **Redis** | Cơ sở dữ liệu nằm trong RAM, rất nhanh, lệnh chạy lần lượt từng cái | Bảng trắng chung của cả rạp, ai cũng nhìn và ghi được ngay | Giữ khóa ghế, đếm số liệu, phát thông báo |
| **TTL** (time to live) | Dữ liệu tự xóa sau một khoảng thời gian | Phiếu giữ chỗ ghi "có hiệu lực 5 phút" | Giữ ghế 5 phút; server chết thì khóa vẫn tự mất |
| **Message queue** (RabbitMQ) | Hàng đợi công việc: bên gửi bỏ vào, bên xử lý lấy ra dần | Hộp thư góp ý: bỏ thư vào rồi đi, người khác đọc sau | Booking Server gửi đơn thanh toán cho Worker |
| **ACK** | Worker báo "tôi đã làm xong" thì hàng đợi mới xóa việc đó | Chỉ gạch tên khách khi đã giao vé xong | Worker chết giữa chừng thì đơn được giao lại |
| **Idempotency** | Làm một việc 2 lần cho kết quả như làm 1 lần | Bấm nút thang máy 5 lần thì thang vẫn chỉ đến 1 lần | Thanh toán bị gửi lại không tạo 2 vé |
| **Pub/Sub** | Một nơi phát tin, mọi ai đăng ký đều nhận | Loa phát thanh của rạp | Báo mọi server khi ghế đổi màu để đẩy xuống trình duyệt |

## 2. Mục tiêu và phạm vi

Mục tiêu chính: không có ghế nào bị bán hai lần, kể cả khi có hàng nghìn request đồng thời hoặc một server bị chết.

**Mục tiêu**

1. **Đúng đắn:** mỗi cặp (suất chiếu, ghế) chỉ có tối đa một vé hợp lệ.
2. **Giữ ghế có thời hạn:** ghế được giữ 5 phút để thanh toán, quá hạn thì tự nhả.
3. **Mở rộng được:** thêm Booking Server chỉ bằng cấu hình (docker-compose.yml và nginx.conf), không sửa code.
4. **Chịu lỗi:** một Booking Server hoặc Worker chết thì hệ thống vẫn phục vụ, không mất vé và không kẹt ghế.
5. **Thời gian thực:** ghế đổi trạng thái thì mọi người đang xem suất chiếu đó thấy ngay.

**Trong phạm vi**

- Xem phim, suất chiếu, sơ đồ ghế; chọn ghế, giữ ghế, thanh toán giả lập, xuất vé.
- Đăng nhập đơn giản bằng tên người dùng (để phân biệt ai đang giữ ghế).
- Dashboard demo: trạng thái server, thống kê, nút bật/tắt khóa phân tán.
- Triển khai toàn bộ bằng Docker Compose trên một máy.

**Ngoài phạm vi**

- Cổng thanh toán thật, gửi email thật (chỉ ghi log).
- Quản trị phim và suất chiếu qua giao diện (dữ liệu nạp sẵn bằng script).
- Triển khai trên nhiều máy vật lý hoặc cloud.

## 3. Yêu cầu

Hệ thống có 8 yêu cầu chức năng và 6 yêu cầu phi chức năng; các yêu cầu phi chức năng là phần thể hiện tính phân tán.

**Yêu cầu chức năng**

| Mã | Chức năng | Mô tả |
| --- | --- | --- |
| F1 | Xem phim | Danh sách phim đang chiếu, thể loại, thời lượng, mô tả |
| F2 | Xem suất chiếu | Các suất của một phim: ngày giờ, phòng chiếu |
| F3 | Xem sơ đồ ghế | Lưới ghế 4 màu: trống (xám), người khác đang giữ (vàng), đã bán (đỏ), của tôi (xanh); ghế VIP có viền tím |
| F4 | Chọn và giữ ghế | **Bấm ghế là giữ ngay**, khách khác thấy ghế chuyển vàng tức thì. Bấm thêm ghế thì gộp vào cùng một lượt giữ, tối đa 8 ghế, chung một đồng hồ đếm ngược 5 phút |
| F5 | Bỏ chọn ghế | Bấm lại ghế của mình để nhả riêng ghế đó, hoặc "Bỏ chọn tất cả" |
| F6 | Thanh toán | Thanh toán giả lập; xử lý bất đồng bộ qua hàng đợi; đang thanh toán thì không thêm/bớt ghế được |
| F7 | Nhận vé | Mã đặt vé 8 ký tự, kết quả đẩy về trình duyệt qua WebSocket (chưa làm mã QR) |
| F8 | Dashboard demo | Server sống/chết, số request mỗi server, số vé bán, số lần tranh chấp, hàng đợi, nút bật/tắt khóa, đổi thời gian giữ ghế, reset suất chiếu |

**Yêu cầu phi chức năng**

| Mã | Thuộc tính | Tiêu chí | Kết quả đo thật (03/11/2026) |
| --- | --- | --- | --- |
| N1 | Nhất quán | 0 ghế bị giữ trùng khi bắn 5.000 request vào 100 ghế | Đạt: đúng 100 lượt giữ thành công, 0 ghế trùng |
| N2 | Hiệu năng | Phục vụ trên 1.000 request/giây trên máy cá nhân | Đạt: ~1.050–1.140 request/giây; p50 ≈ 140–170 ms, p95 ≈ 370–570 ms với 200 request đồng thời |
| N3 | Mở rộng | Thêm server chỉ bằng cấu hình, không sửa code | Đạt: 3 server chạy cùng một image, tải chia đều 1.667 request/server |
| N4 | Sẵn sàng | Tắt 1 trong 3 server, người dùng không bị gián đoạn | Đạt: 12/12 request vẫn trả 200 sau `docker stop booking-2` |
| N5 | Chịu lỗi | Ghế tự nhả khi hết hạn; Worker chết không mất đơn | Đạt: ghế về trống đúng hạn; đơn chờ trong hàng đợi rồi PAID khi Worker bật lại |
| N6 | Trong suốt | Người dùng không cần biết server nào phục vụ | Đạt: mọi request qua một địa chỉ `localhost:8080`; các ghế của cùng một lượt giữ có thể do 3 server khác nhau xử lý |

Số liệu đo trên laptop cá nhân, toàn bộ 9 container chạy trên cùng một máy; máy khác sẽ cho con số khác.

## 4. Kiến trúc hệ thống

Hệ thống gồm 8 thành phần, mỗi thành phần chạy trong một container Docker. Điểm mấu chốt: 3 Booking Server không nói chuyện trực tiếp với nhau mà phối hợp qua kho chung (Redis, PostgreSQL, RabbitMQ).

![Hình 1. Kiến trúc hệ thống – 8 thành phần, mỗi thành phần một container](docs/kien-truc.png)

**Đọc sơ đồ từ trên xuống**

1. **Trình duyệt** gửi mọi yêu cầu tới một địa chỉ duy nhất (ví dụ `localhost:8080`). Người dùng không biết có 3 server phía sau.
2. **Nginx** nhận request và chuyển cho một trong 3 Booking Server theo vòng (round-robin). Nếu một server không trả lời, Nginx bỏ qua nó và gửi sang server khác.
3. **Booking Server** chứa toàn bộ logic nghiệp vụ. Cả 3 chạy cùng một code, chỉ khác tên (biến môi trường `SERVER_NAME`). Chúng không lưu gì trong bộ nhớ riêng, nên tắt một server không mất dữ liệu.
4. **Redis** là trái tim của đề tài. Server nào muốn giữ ghế cũng phải xin khóa ở đây. Vì Redis thực hiện từng lệnh một, hai lệnh xin cùng ghế không bao giờ cùng thành công.
5. **PostgreSQL** lưu dữ liệu lâu dài (phim, suất chiếu, vé đã bán). Ràng buộc UNIQUE là lớp bảo vệ thứ hai nếu Redis có sự cố.
6. **RabbitMQ** nhận đơn thanh toán. Booking Server ghi đơn PENDING vào PostgreSQL, bỏ job vào hàng đợi rồi trả lời người dùng ngay, không phải chờ xử lý xong.
7. **Payment Worker** lấy đơn từ hàng đợi, ghi vé và chuyển đơn sang PAID trong một transaction, rồi mới gửi ACK. Worker chết trước khi ACK thì RabbitMQ giao lại đơn cho lần sau.
8. **Expiry Listener** là một tiến trình nhỏ lắng nghe Redis. Khi một khóa ghế hết hạn, nó phát sự kiện để mọi trình duyệt đổi ghế đó về màu xám.

**Vì sao thiết kế như vậy?** Muốn chịu tải thì phải có nhiều server. Muốn nhiều server không giẫm chân nhau thì chúng phải hỏi chung một nơi trước khi quyết định. Redis là nơi đó vì nó nhanh và có sẵn TTL.

## 5. Thiết kế dữ liệu

PostgreSQL giữ dữ liệu chính thức và là chốt chặn cuối; Redis giữ trạng thái tạm thời (ghế đang giữ) và khóa.

**Các bảng PostgreSQL**

| Bảng | Cột chính | Ghi chú |
| --- | --- | --- |
| `movies` | id, title, genre, duration_min, description | 3 phim mẫu |
| `rooms` | id, name, rows, cols | Phòng 1: 10 × 10 = 100 ghế; Phòng 2: 8 × 12 = 96 ghế |
| `seats` | id, room_id, row_label, col_no, type | type: standard hoặc vip (2 hàng giữa, phụ thu 20.000 đ) |
| `showtimes` | id, movie_id, room_id, start_at, price | 6 suất chiếu mẫu; price = giá ghế thường |
| `bookings` | id (UUID), user_id, showtime_id, seat_ids, hold_token, status, total, code, error, served_by, idempotency_key, created_at, updated_at | **Booking Server tạo đơn PENDING**, Worker chuyển sang PAID hoặc FAILED; `idempotency_key` UNIQUE |
| `tickets` | id, booking_id, showtime_id, seat_id | **UNIQUE (showtime_id, seat_id)** |

Ràng buộc `UNIQUE (showtime_id, seat_id)` trên bảng `tickets` là lớp bảo vệ thứ hai. Nếu vì lý do nào đó hai người cùng vượt qua khóa Redis, database vẫn từ chối vé thứ hai và đơn đó bị FAILED. Cột `idempotency_key` (UNIQUE) chặn việc cùng một lần bấm thanh toán tạo ra hai đơn. Cột `served_by` ghi server đã nhận đơn, dùng khi demo.

**Các key Redis**

| Key | Kiểu | Giá trị | Thời hạn |
| --- | --- | --- | --- |
| `seat:{showtimeId}:{seatId}` | String | `{userId}:{holdToken}` khi đang giữ; `SOLD` khi đã bán | Đang giữ: TTL = thời gian còn lại của lượt giữ. SOLD: không hết hạn |
| `hold:{holdToken}` | Hash | showtimeId, seatIds, userId, expiresAt, paying | Thời gian giữ + 3 phút |
| `config:lock_enabled`, `config:hold_ttl` | String | Bật/tắt khóa; thời gian giữ ghế (đổi từ dashboard, áp dụng cho mọi server) | Không |
| `server:{tên}` | String | Nhịp tim của từng Booking Server, ghi lại 2 giây/lần | 6 giây |
| `stats:requests:{tên}`, `stats:hold_ok`, `stats:hold_conflict` | Counter | Số liệu cho dashboard | Không |
| `socket.io#…` | Pub/Sub | Kênh nội bộ của Socket.IO Redis adapter để chuyển sự kiện giữa các server | – |

`holdToken` là chuỗi ngẫu nhiên (UUID) đại diện cho **một lượt giữ** – giống một giỏ hàng. Mỗi người có một lượt giữ cho mỗi suất chiếu; mọi ghế bấm thêm đều dùng chung `holdToken` và chung thời điểm hết hạn. Nhờ token, một server chỉ nhả được khóa do chính lượt giữ đó tạo ra, không nhả nhầm khóa của người khác. Trường `paying` bật lên khi đã gửi thanh toán, từ đó không thêm/bớt ghế được nữa.

## 6. Luồng xử lý và các cơ chế phân tán

Mỗi ghế của một suất chiếu luôn ở đúng 1 trong 3 trạng thái. Toàn bộ code của đề tài chỉ là đảm bảo các bước chuyển trạng thái này đúng, kể cả khi nhiều server chạy cùng lúc.

**Toàn cảnh một lượt đặt vé**

![Hình 2. Flow một lượt đặt vé – 7 thành phần, 21 bước](docs/flow-dat-ve.png)

Các bước 5–9 lặp lại mỗi lần bấm thêm ghế, và mỗi lần có thể do một Booking Server khác xử lý. Khách B là bất kỳ ai đang xem cùng suất chiếu; các mũi tên màu là sự kiện đi qua Redis tới mọi server rồi xuống trình duyệt.

**Vòng đời của một ghế**

![Hình 3. Vòng đời của một ghế – 3 trạng thái](docs/trang-thai-ghe.png)

**Bước 1 – Giữ ghế (phần quan trọng nhất)**

Người dùng **bấm vào ghế F7 là ghế được giữ ngay** – không có bước "chọn trước, giữ sau", nên khách khác thấy F7 chuyển vàng tức thì. Booking Server chạy một script Lua trên Redis; Redis chạy nguyên cả script như một lệnh duy nhất, không ai chen vào giữa được. Bấm thêm F8: trình duyệt gửi kèm `holdToken` đang có, server khóa F8 với cùng giá trị và TTL bằng thời gian còn lại, nên cả lượt giữ (tối đa 8 ghế) hết hạn cùng lúc. Trình duyệt gửi các lần bấm lần lượt, nên mọi ghế vào đúng một lượt giữ dù mỗi lần do một server khác xử lý.

```javascript
// booking-service/src/services/seatLock.js – giữ TẤT CẢ ghế hoặc KHÔNG giữ ghế nào
const HOLD_SCRIPT = `
for i, key in ipairs(KEYS) do
  if redis.call('EXISTS', key) == 1 then return i end   -- trả về vị trí ghế bị trùng
end
for i, key in ipairs(KEYS) do
  redis.call('SET', key, ARGV[1], 'EX', ARGV[2])
end
return 0`;

// booking-service/src/services/holdService.js (rút gọn)
const holdToken = hold ? hold.holdToken : crypto.randomUUID();      // gộp vào lượt giữ cũ nếu có
const expiresAt = hold ? hold.expiresAt : Date.now() + holdTtl * 1000;
const ttl = Math.ceil((expiresAt - Date.now()) / 1000);             // ghế thêm sau hết hạn cùng lúc
const result = await seatLock.hold(showtimeId, newIds, `${userId}:${holdToken}`, ttl);
if (!result.ok) throw new HttpError(409, `Ghế ${label} đã có người chọn`);
```

Tại sao phải dùng Lua? Nếu viết kiểu thông thường "kiểm tra trước (GET), rồi mới ghi (SET)", hai server có thể cùng kiểm tra thấy trống trước khi một trong hai kịp ghi. Đó chính là cách làm sai mà nút "tắt khóa" trong dashboard dùng để demo lỗi.

**Bước 2 – Báo cho mọi người**

Giữ thành công thì server phát `seats_held` vào phòng Socket.IO của suất chiếu. Redis adapter chuyển sự kiện sang cả 2 server còn lại, nên ai đang xem suất chiếu đó cũng thấy F7, F8 chuyển vàng.

```javascript
io.to(`showtime:${showtimeId}`).emit('seats_held', { seatIds, userId });
```

**Bước 3 – Thanh toán (bất đồng bộ)**

Người dùng bấm "Thanh toán". Booking Server làm 4 việc rồi trả lời `202 Đang xử lý` ngay:

1. Nếu đã có đơn với cùng header `Idempotency-Key` thì trả lại đúng đơn đó, không tạo đơn mới.
2. Kiểm tra mọi key ghế vẫn mang đúng `{userId}:{holdToken}` của người này, rồi gia hạn thêm 2 phút để khóa không hết hạn khi Worker đang xử lý (một script Lua).
3. **Ghi đơn trạng thái PENDING vào PostgreSQL** và bật cờ `paying` cho lượt giữ. Đơn được tạo ở đây (không phải ở Worker) để trình duyệt có ngay `bookingId` mà theo dõi.
4. Gửi job `{ bookingId, userId, showtimeId, seatIds, holdToken }` vào hàng đợi `payments` với chế độ `persistent` (RabbitMQ ghi xuống đĩa, khởi động lại không mất).

**Bước 4 – Worker ghi vé**

Worker lấy job, bỏ qua nếu đơn không còn PENDING (đã xử lý ở lần giao trước), giả lập gọi cổng thanh toán 0,8 giây, rồi mở một transaction trong PostgreSQL:

```javascript
// payment-worker/src/worker.js (rút gọn)
await client.query('BEGIN');
const b = await client.query('SELECT status FROM bookings WHERE id = $1 FOR UPDATE', [job.bookingId]);
if (b.rows[0].status !== 'PENDING') { await client.query('ROLLBACK'); return; }   // idempotent
// UNIQUE (showtime_id, seat_id) → ghế đã có vé thì lệnh này lỗi 23505
await client.query('INSERT INTO tickets (booking_id, showtime_id, seat_id) SELECT $1, $2, unnest($3::int[])', [...]);
await client.query("UPDATE bookings SET status = 'PAID', code = $2 WHERE id = $1", [...]);
await client.query('COMMIT');
// sau đó: đặt key ghế = SOLD, phát seats_sold + booking_result, rồi mới:
ch.ack(msg);

// xử lý lỗi
// - lỗi 23505 (ghế đã bán) hoặc thẻ bị từ chối → đơn FAILED, nhả ghế, ack
// - lỗi tạm thời (DB/Redis chập chờn) → gửi lại vào hàng đợi, tối đa 3 lần
// - quá 3 lần → ch.nack(msg, false, false) → vào dead-letter queue payments.dlq
```

Nếu Worker chết trước dòng `ack`, RabbitMQ thấy kết nối đứt và giao lại job. Lần giao lại không tạo vé trùng vì đơn đã không còn PENDING (kiểm tra bằng `SELECT … FOR UPDATE`). Worker và Expiry Listener không phải Socket.IO server, nên chúng phát sự kiện bằng **Socket.IO Redis emitter**: ghi sự kiện lên Redis, các Booking Server nhận và đẩy xuống trình duyệt.

**Bước 5 – Ghế hết hạn**

Bật tính năng thông báo hết hạn của Redis (`notify-keyspace-events Ex`). Expiry Listener đăng ký kênh `__keyevent@0__:expired`. Khi key `seat:12:F7` hết hạn, nó phát `seats_released` và ghế về màu xám trên mọi màn hình.

Đây cũng là cơ chế chịu lỗi: nếu Booking Server chết ngay sau khi giữ ghế, không ai cần dọn dẹp. Redis tự xóa khóa khi hết TTL.

**Bước 6 – Bỏ chọn ghế**

Bấm lại ghế của mình (nhả riêng ghế đó) hoặc "Bỏ chọn tất cả" cũng dùng Lua: chỉ xóa key nếu giá trị còn đúng `holdToken` của mình. Nếu không kiểm tra, người A có thể xóa nhầm khóa mà người B vừa giữ sau khi khóa của A hết hạn.

```javascript
const RELEASE_SCRIPT = `
local n = 0
for i, key in ipairs(KEYS) do
  if redis.call('GET', key) == ARGV[1] then redis.call('DEL', key); n = n + 1 end
end
return n`;
```

## 7. Thiết kế API và sự kiện realtime

Client gọi REST để thao tác và nghe Socket.IO để nhận thay đổi ghế; mọi API đều stateless nên server nào cũng trả lời được.

**REST API**

| Method | Đường dẫn | Chức năng | Kết quả chính |
| --- | --- | --- | --- |
| POST | `/api/auth/login` | Đăng nhập bằng tên `{ name }` | JWT token |
| GET | `/api/movies` | Danh sách phim | 200 |
| GET | `/api/movies/:id/showtimes` | Suất chiếu của phim | 200 |
| GET | `/api/showtimes/:id/seats` | Sơ đồ ghế, gộp trạng thái PostgreSQL (đã bán) và Redis (đang giữ) | 200 |
| POST | `/api/showtimes/:id/holds` | Giữ ghế `{ seatIds, holdToken? }`; có holdToken thì gộp vào lượt giữ đang có | 201 kèm holdToken, seatIds, expiresAt; 409 nếu ghế đã có người giữ hoặc đã bán |
| DELETE | `/api/holds/:holdToken/seats/:seatId` | Nhả một ghế | 200 kèm các ghế còn giữ |
| DELETE | `/api/holds/:holdToken` | Nhả tất cả ghế | 200 |
| POST | `/api/bookings` | Thanh toán `{ holdToken }`, header `Idempotency-Key` | 202 kèm đơn PENDING (`duplicate: true` nếu gửi trùng) |
| GET | `/api/bookings/:id` | Trạng thái đơn, ghế, mã vé | 200 |
| GET | `/api/admin/stats` | Số liệu dashboard (server, khóa, hàng đợi, đơn) | 200 |
| PUT | `/api/admin/lock` | Bật/tắt khóa phân tán `{ enabled }` (chỉ để demo) | 200 |
| PUT | `/api/admin/hold-ttl` | Đổi thời gian giữ ghế `{ seconds }` (10–3600) | 200 |
| POST | `/api/admin/reset` | Xóa vé, đơn, khóa ghế của một suất chiếu `{ showtimeId }` | 200 |
| GET | `/health` | Kiểm tra server còn sống | 200 kèm tên server |

Mọi response có header `X-Served-By` ghi tên server đã xử lý. Header này giúp chứng minh khi demo rằng request được chia cho nhiều server.

**Sự kiện Socket.IO**

| Chiều | Sự kiện | Dữ liệu |
| --- | --- | --- |
| Client → Server | `join_showtime` | showtimeId (vào "phòng" của suất chiếu) |
| Client → Server | `leave_showtime` | showtimeId |
| Server → Client | `hello` | tên server mà WebSocket đang nối tới (hiện trên trang để demo) |
| Server → Client | `seats_held` | seatIds, userId, by (server phát) |
| Server → Client | `seats_released` | seatIds, reason (`expired` nếu do hết hạn) |
| Server → Client | `seats_sold` | seatIds |
| Server → Client | `seats_reset` | dashboard vừa reset suất chiếu |
| Server → Client | `booking_result` | bookingId, status, code (chỉ gửi cho người đặt) |

Vì người xem cùng một suất chiếu có thể kết nối vào các server khác nhau, Socket.IO dùng **Redis adapter** để phát sự kiện sang mọi server.

## 8. Công nghệ và cấu trúc dự án

Toàn bộ backend viết bằng Node.js và chạy bằng một lệnh `docker compose up`.

| Lớp | Công nghệ | Thư viện / ghi chú |
| --- | --- | --- |
| Booking Server | Node.js 20 + Express | `express`, `jsonwebtoken`; kiểm tra dữ liệu vào viết tay (không dùng `zod`) |
| Realtime | Socket.IO 4 | `socket.io`, `@socket.io/redis-adapter`; Worker và Listener dùng `@socket.io/redis-emitter` |
| Khóa và cache | Redis 7 | `ioredis`, script Lua |
| Cơ sở dữ liệu | PostgreSQL 16 | `pg` |
| Hàng đợi | RabbitMQ 3 (management) | `amqplib` |
| Cân bằng tải | Nginx | Round-robin, keepalive tới server, tự bỏ qua server chết; **không dùng `ip_hash`** vì client chỉ dùng transport WebSocket |
| Frontend | HTML, CSS, JavaScript thuần | `socket.io-client` do Booking Server phục vụ |
| Triển khai | Docker, Docker Compose | 9 container |
| Kiểm thử tải | Script Node `loadtest/rush.js` | Dùng `fetch` có sẵn của Node, **không cần cài k6** |
| Unit test | `node:test` | 8 test cho khóa ghế, chạy với Redis thật |

**Cấu trúc thư mục**

```
cinema-booking/
├── docker-compose.yml
├── README.md
├── nginx/nginx.conf             # upstream 3 server, failover, WebSocket
├── db/
│   ├── schema.sql               # tạo bảng + ràng buộc UNIQUE
│   └── seed.sql                 # 3 phim, 2 phòng, 6 suất chiếu, ghế
├── booking-service/
│   ├── Dockerfile, package.json
│   ├── src/
│   │   ├── index.js             # khởi động Express + Socket.IO, header X-Served-By
│   │   ├── config.js, errors.js
│   │   ├── middleware/auth.js   # JWT
│   │   ├── routes/index.js      # toàn bộ REST API
│   │   ├── services/
│   │   │   ├── seatLock.js      # khóa ghế phân tán (Lua script)
│   │   │   ├── holdService.js   # giữ / gộp / nhả ghế
│   │   │   ├── bookingService.js# thanh toán, idempotency, gửi RabbitMQ
│   │   │   ├── catalogService.js# phim, suất chiếu, sơ đồ ghế
│   │   │   ├── adminService.js  # số liệu, nhịp tim, reset demo
│   │   │   └── settings.js      # cấu hình dùng chung trên Redis
│   │   ├── realtime/socket.js   # Socket.IO + Redis adapter
│   │   └── infra/               # redis.js, db.js, mq.js
│   └── tests/seatLock.test.js   # 8 test khóa ghế
├── payment-worker/src/worker.js # ACK thủ công, retry, dead-letter, idempotent
├── expiry-listener/src/listener.js  # nghe __keyevent@0__:expired
├── frontend/
│   ├── index.html               # đăng nhập + danh sách phim
│   ├── seats.html               # sơ đồ ghế, bấm là giữ
│   ├── dashboard.html           # dashboard demo
│   └── assets/app.js, style.css
└── loadtest/rush.js             # kiểm thử tải 5.000 request vào 100 ghế
```

## 9. Kịch bản demo và kiểm thử

Buổi bảo vệ gồm 6 kịch bản; mỗi kịch bản chứng minh một mục tiêu và có kết quả mong đợi đo được.

| # | Kịch bản | Cách làm | Kết quả mong đợi | Chứng minh |
| --- | --- | --- | --- | --- |
| D1 | Hai người cùng bấm một ghế | Mở 2 trình duyệt (1 thường + 1 ẩn danh), đăng nhập 2 tên, vào cùng suất chiếu. An bấm F7 | Bình thấy F7 chuyển vàng ngay; Bình bấm F7 nhận "Ghế F7 đã có người chọn". Ô "WebSocket nối với" cho thấy 2 người có thể ở 2 server khác nhau | Loại trừ tương hỗ, realtime |
| D2 | Bắn tải, so sánh trước và sau | `node loadtest/rush.js` khi khóa BẬT; tắt khóa trên dashboard rồi chạy lại | Bật khóa: đúng 100 lượt giữ, 0 trùng. Tắt khóa: hơn 100 lượt "thành công", nhiều ghế trùng | Nhất quán dưới tải cao |
| D3 | Giữ ghế hết hạn | Dashboard: đặt thời gian giữ 20 giây. Giữ ghế rồi không thanh toán | Sau 20 giây ghế tự về màu xám trên mọi màn hình | Khóa có thời hạn |
| D4 | Booking Server chết | `docker stop booking-2` trong lúc đang đặt vé | Trang vẫn chạy; dashboard báo booking-2 CHẾT sau tối đa 6 giây | Sẵn sàng, chịu lỗi |
| D5 | Worker chết | `docker stop payment-worker`, rồi thanh toán | Đơn chờ trong RabbitMQ (dashboard: hàng đợi = 1, không có worker); `docker start payment-worker` thì đơn PAID | Hàng đợi bền vững |
| D6 | Gửi trùng thanh toán | Trên trang ghế, bấm link "Thử gửi trùng thanh toán 2 lần" | 2 request cùng Idempotency-Key chỉ tạo 1 đơn | Idempotency |

**Số liệu cần đo và đưa vào báo cáo**

- Số ghế bị bán trùng khi tắt và bật khóa (kịch bản D2).
- Thông lượng (request/giây) và độ trễ p95 khi chạy 1, 2 và 3 Booking Server.
- Thời gian Nginx phát hiện server chết và chuyển hướng (kịch bản D4).

**Kết quả đã đo (03/11/2026, laptop cá nhân, 9 container trên cùng một máy)**

| Kiểm thử | Kết quả |
| --- | --- |
| D2 – 5.000 request, 200 đồng thời, 100 ghế, **bật khóa** | 201 = 100, 409 = 4.900, **0 ghế trùng**; ~1.050–1.140 request/giây; chia đều ~1.667 request/server |
| D2 – như trên, **tắt khóa** | 119–170 lượt "thành công" trên 100 ghế, **19–51 ghế bị giữ trùng** |
| D3 – TTL 10 giây | Ghế đang giữ → trống sau 12 giây; Expiry Listener ghi log sự kiện hết hạn |
| D4 – tắt booking-2 | 12/12 request vẫn 200; dashboard báo CHẾT, bật lại thì SỐNG |
| D5 – tắt Worker | Đơn PENDING, hàng đợi pending = 1, consumers = 0; bật lại → PAID |
| D6 – gửi trùng | 2 request → cùng một mã đơn |
| Chọn nhiều ghế | 3 lần bấm do 3 server khác nhau xử lý vẫn vào cùng một lượt giữ; người xem khác thấy từng ghế chuyển vàng ngay |
| Realtime | 4 client nối vào 3 server khác nhau đều nhận `seats_held` và `seats_sold` |
| Unit test | 8/8 đạt (`docker compose exec booking-1 npm test`) |

## 10. Liên hệ với nội dung môn học

Đề tài áp dụng kiến thức của 7 trên 9 chương giáo trình *Distributed Systems* (van Steen & Tanenbaum, bản 4), tập trung vào chương 5, 7 và 8.

| Chương | Khái niệm | Thể hiện trong đề tài |
| --- | --- | --- |
| 1. Introduction | Tính trong suốt, khả năng mở rộng | Người dùng không biết server nào phục vụ; scale số Booking Server |
| 2. Architectures | Client–server nhiều tầng, publish–subscribe | Nginx → Booking Server → Redis/PostgreSQL/RabbitMQ; Redis Pub/Sub |
| 3. Processes | Nhân bản server, ảo hóa bằng container | Booking Server stateless, mỗi thành phần một container |
| 4. Communication | RPC/REST, truyền thông hướng thông điệp | REST, WebSocket, RabbitMQ với ACK và dead-letter |
| 5. Coordination | Loại trừ tương hỗ, vấn đề đồng hồ | Khóa ghế tập trung trên Redis; khóa theo TTL thay vì so giờ giữa các máy |
| 7. Consistency & Replication | Nhất quán, client-centric consistency | Trạng thái ghế giống nhau trên mọi server; Redis và PostgreSQL không mâu thuẫn |
| 8. Fault Tolerance | Mô hình lỗi crash, giao tiếp tin cậy, phục hồi | Server chết, khóa tự hết hạn, message không mất, idempotency khi xử lý lại |

Thuật toán khóa trong đề tài là dạng **loại trừ tương hỗ tập trung** (centralized mutual exclusion) của chương 5: Redis đóng vai coordinator cấp quyền cho từng ghế. Khi bảo vệ nên nói rõ điểm yếu của nó là coordinator có thể là điểm chết duy nhất, và hướng khắc phục ở mục 12.

## 11. Kế hoạch thực hiện

Phần code của tuần 1–3 đã hoàn thành và chạy được (03/11/2026); còn lại tuần 4: báo cáo, slide, tập demo. Kế hoạch gốc giữ lại bên dưới để đưa vào báo cáo.

**Tuần 1 – Nền tảng**

- [ ] Docker Compose: PostgreSQL, Redis, RabbitMQ, Nginx, 1 Booking Server
- [ ] Schema, dữ liệu mẫu (3 phim, 2 phòng, 6 suất chiếu)
- [ ] API xem phim, suất chiếu, sơ đồ ghế; trang `index.html`, `seats.html`

**Tuần 2 – Cơ chế phân tán cốt lõi**

- [ ] `seatLock.js`: giữ nhiều ghế nguyên tử bằng Lua, nhả theo holdToken
- [ ] API giữ/nhả ghế; scale lên 3 Booking Server sau Nginx
- [ ] Socket.IO + Redis adapter; expiry-listener phát `seats_released`

**Tuần 3 – Thanh toán và chịu lỗi**

- [ ] RabbitMQ: hàng đợi `payments` bền vững, ACK thủ công, retry, dead-letter
- [ ] payment-worker ghi vé trong transaction, idempotency key
- [ ] Health-check, dashboard demo, nút bật/tắt khóa

**Tuần 4 – Kiểm thử và báo cáo**

- [ ] Kịch bản k6, chạy đủ 6 kịch bản demo, ghi số liệu
- [ ] Viết báo cáo, vẽ sơ đồ, làm slide
- [ ] Tập demo ít nhất 2 lần trên máy sẽ dùng khi bảo vệ

**Phân công gợi ý cho nhóm 3 người:** (1) khóa ghế và Booking Server; (2) RabbitMQ, Worker, database; (3) frontend, realtime, dashboard, kiểm thử tải. Cả nhóm cùng viết báo cáo.

## 12. Rủi ro, hạn chế và hướng mở rộng

Hạn chế lớn nhất là Redis chạy một bản duy nhất nên vẫn là điểm chết; nên chủ động nói điều này khi bảo vệ.

| Rủi ro / hạn chế | Hậu quả | Cách xử lý trong đề tài |
| --- | --- | --- |
| Redis chết | Không giữ ghế mới được | UNIQUE trong PostgreSQL vẫn chặn vé trùng; mở rộng bằng Redis Sentinel |
| Khóa hết hạn khi Worker đang ghi vé | Người khác giữ được ghế đang thanh toán | Gia hạn khóa khi bắt đầu thanh toán; UNIQUE chặn vé thứ hai, đơn thứ hai bị FAILED |
| WebSocket dính vào server đã chết | Trình duyệt ngừng nhận cập nhật | Socket.IO tự kết nối lại, Nginx chuyển sang server khác; khi nối lại thì tải lại sơ đồ ghế |
| Thông báo hết hạn của Redis không đảm bảo tới nơi | Một ghế có thể vẫn hiện vàng dù đã trống | API sơ đồ ghế luôn đọc trạng thái thật từ Redis; frontend tải lại định kỳ 30 giây |
| Tất cả chạy trên một máy | Chưa phải phân tán vật lý thật | Container mô phỏng các node tách biệt; có thể chạy trên 2–3 máy trong cùng mạng LAN |

**Hướng mở rộng để lấy điểm cộng** (chọn 1–2 mục nếu còn thời gian)

- **Redis Sentinel hoặc Redlock:** nhiều Redis để khóa không còn là điểm chết duy nhất (chương 8).
- **Nhiều Worker có bầu chọn leader:** chỉ leader làm việc dọn đơn PENDING quá hạn (chương 5).
- **Saga:** thanh toán lỗi thì tự hoàn tác giữ ghế và báo người dùng.
- **Prometheus + Grafana:** biểu đồ request/giây, độ trễ, số lần tranh chấp ghế.

**Câu hỏi thường gặp khi bảo vệ, chuẩn bị trước**

1. *Tại sao không chỉ dùng transaction của database?* → Dùng được, nhưng mọi lượt chọn ghế đều khóa dòng trong database, chậm khi tải cao. Redis chặn nhanh ở lớp đầu, database chỉ là lớp cuối.
2. *Server chết khi đang giữ khóa thì sao?* → Khóa có TTL, tự mất sau tối đa 5 phút.
3. *Đây là thuật toán loại trừ tương hỗ nào?* → Loại trừ tương hỗ tập trung, Redis là coordinator.
4. *Tại sao thanh toán qua hàng đợi?* → Server trả lời ngay, chịu được lúc đông; Worker chết cũng không mất đơn.
5. *Hệ thống chọn C hay A trong định lý CAP?* → Chọn C (nhất quán): khi không liên lạc được Redis, hệ thống từ chối giữ ghế chứ không bán liều.

## 13. Khác biệt giữa thiết kế ban đầu và bản cài đặt

Khi cài đặt thật, nhóm đổi 8 điểm so với thiết kế ban đầu; các mục trên đã được cập nhật theo bản cài đặt.

| Thiết kế ban đầu | Bản cài đặt | Lý do |
| --- | --- | --- |
| Chọn ghế trên máy mình rồi bấm "Giữ ghế" | Bấm ghế là giữ ngay; bấm thêm thì gộp vào cùng lượt giữ | Khách khác thấy ghế đang được chọn ngay lập tức; chọn thêm ghế không phải bỏ chọn làm lại |
| Worker tạo đơn trong bảng `bookings` | Booking Server tạo đơn PENDING; Worker chỉ chuyển PAID/FAILED và ghi vé | Trình duyệt có ngay mã đơn để theo dõi; idempotency kiểm tra ngay tại API |
| Kiểm thử tải bằng k6 | Script Node `loadtest/rush.js` | Không phải cài thêm công cụ; tự đếm số ghế bị giữ trùng |
| Nginx `ip_hash` cho WebSocket | Round-robin cho cả REST và WebSocket, keepalive tới server | Client chỉ dùng transport WebSocket nên không cần sticky session; 2 trình duyệt trên cùng máy vẫn vào 2 server khác nhau |
| Kênh `showtime:{id}:events` tự làm | Socket.IO Redis adapter + Redis emitter | Thư viện có sẵn, Worker và Listener phát sự kiện được mà không cần là Socket.IO server |
| Dùng `zod` kiểm tra dữ liệu | Kiểm tra viết tay | Dữ liệu vào ít, bớt một thư viện |
| Vé có mã QR | Mã đặt vé 8 ký tự | Không liên quan kiến thức phân tán; có thể bổ sung sau |
| Thêm server bằng `docker compose up --scale` | 3 service cố định booking-1/2/3 | Có tên cố định để demo `docker stop booking-2` và hiện tên trên dashboard |

Ngoài ra, bản cài đặt có thêm: nhịp tim server trên Redis cho dashboard, cấu hình dùng chung (bật/tắt khóa, thời gian giữ) đổi được lúc chạy, và cơ chế thử lại 3 lần rồi đưa vào dead-letter queue ở Worker.
