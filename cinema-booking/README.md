# CinemaDS – Hệ thống đặt vé xem phim phân tán chống đặt trùng ghế

Đồ án môn **Các hệ thống phân tán**. Nhiều Booking Server chạy song song sau Nginx; mỗi ghế của một
suất chiếu chỉ bán được đúng một lần nhờ **khóa phân tán trên Redis** (lớp 1) và **ràng buộc UNIQUE
trong PostgreSQL** (lớp 2). Thanh toán xử lý bất đồng bộ qua **RabbitMQ**.

![Kiến trúc hệ thống](../docs/kien-truc.png)

![Flow một lượt đặt vé](../docs/flow-dat-ve.png)

## Chạy hệ thống

Yêu cầu: Docker Desktop đang chạy, Node.js 18+ (chỉ để chạy script kiểm thử tải).

```bash
cd cinema-booking
docker compose up -d --build      # lần đầu mất vài phút để tải image
docker compose ps                 # 9 container phải ở trạng thái Up
```

| Địa chỉ | Nội dung |
| --- | --- |
| http://localhost:8080 | Trang đặt vé (danh sách phim → chọn suất → sơ đồ ghế) |
| http://localhost:8080/dashboard.html | Dashboard demo: server sống/chết, bật/tắt khóa, số liệu, sơ đồ ghế realtime |
| http://localhost:15673 | Trang quản trị RabbitMQ (cinema / cinema) |

Dừng: `docker compose down` · Xóa sạch dữ liệu để chạy lại từ đầu: `docker compose down -v`

## Các thành phần (9 container)

| Container | Vai trò |
| --- | --- |
| `cinema-nginx` | Load balancer, chia request round-robin cho 3 Booking Server, tự bỏ qua server chết; phục vụ frontend |
| `booking-1`, `booking-2`, `booking-3` | Booking Server (Node.js + Express + Socket.IO), stateless, cùng một code |
| `cinema-redis` | Khóa ghế (TTL), cấu hình dùng chung, nhịp tim server, Pub/Sub cho Socket.IO |
| `cinema-postgres` | Phim, suất chiếu, ghế, đơn, vé (`UNIQUE (showtime_id, seat_id)`) |
| `cinema-rabbitmq` | Hàng đợi `payments` (durable) + dead-letter queue `payments.dlq` |
| `payment-worker` | Lấy đơn, giả lập thanh toán, ghi vé trong transaction, ACK sau khi ghi xong |
| `expiry-listener` | Nghe sự kiện hết hạn khóa ghế của Redis, báo trình duyệt đổi ghế về trống |

## Cấu trúc thư mục

```
cinema-booking/
├── docker-compose.yml
├── nginx/nginx.conf                  # upstream 3 server, failover, WebSocket
├── db/schema.sql, db/seed.sql        # bảng + dữ liệu mẫu (3 phim, 2 phòng, 6 suất)
├── booking-service/
│   ├── src/index.js                  # khởi động Express + Socket.IO, header X-Served-By
│   ├── src/services/seatLock.js      # ★ KHÓA GHẾ PHÂN TÁN (Lua script trên Redis)
│   ├── src/services/holdService.js   # giữ / gộp / nhả ghế (một lượt giữ = một giỏ hàng)
│   ├── src/services/bookingService.js# thanh toán: kiểm tra lượt giữ, idempotency, gửi RabbitMQ
│   ├── src/services/catalogService.js# phim, suất chiếu, sơ đồ ghế
│   ├── src/services/adminService.js  # số liệu dashboard, nhịp tim, reset demo
│   ├── src/realtime/socket.js        # Socket.IO + Redis adapter
│   ├── src/routes/index.js           # toàn bộ REST API
│   └── tests/seatLock.test.js        # 8 test cho khóa ghế
├── payment-worker/src/worker.js      # ★ ACK thủ công, retry, dead-letter, idempotent
├── expiry-listener/src/listener.js   # nghe __keyevent@0__:expired
├── frontend/                         # index.html, seats.html, dashboard.html, assets/
└── loadtest/rush.js                  # kiểm thử tải 5.000 request vào 100 ghế
```

## Kịch bản demo

| # | Kịch bản | Cách làm |
| --- | --- | --- |
| D1 | Hai người cùng bấm một ghế | Mở 2 trình duyệt (1 thường + 1 ẩn danh), đăng nhập 2 tên khác nhau, vào cùng suất chiếu. **Bấm vào ghế là giữ ngay**: An bấm F7 → bên Bình thấy F7 chuyển vàng tức thì; Bình bấm F7 → "Ghế F7 đã có người chọn". Bấm thêm ghế thì gộp vào cùng lượt giữ (tối đa 8), bấm lại ghế của mình để bỏ. Ô "WebSocket nối với" cho thấy 2 trình duyệt có thể ở 2 server khác nhau mà vẫn thấy nhau. |
| D2 | Bắn tải, bật/tắt khóa | `node loadtest/rush.js` khi khóa BẬT → 100 lượt giữ thành công, 0 trùng. Tắt khóa trên dashboard, chạy lại → hơn 100 lượt "thành công", hàng chục ghế bị giữ trùng. **Nhớ bật lại khóa sau khi demo.** |
| D3 | Giữ ghế hết hạn | Dashboard: đặt thời gian giữ ghế 20 giây. Giữ ghế rồi không thanh toán → sau 20 giây ghế tự về màu xám trên mọi màn hình. |
| D4 | Booking Server chết | `docker stop booking-2` → dashboard báo CHẾT sau tối đa 6 giây, trang đặt vé vẫn chạy bình thường. `docker start booking-2` để bật lại. |
| D5 | Worker chết | `docker stop payment-worker`, đặt vé và thanh toán → đơn nằm chờ (dashboard: hàng đợi = 1, "không có worker nào"). `docker start payment-worker` → đơn được xử lý, nhận mã vé. |
| D6 | Gửi trùng thanh toán | Trên trang ghế, giữ ghế rồi bấm link "Thử gửi trùng thanh toán 2 lần" → 2 request cùng Idempotency-Key chỉ tạo 1 đơn. |

Tùy chọn của script tải: `node loadtest/rush.js --requests 2000 --concurrency 100 --showtime 3 --no-reset`

## Kiểm thử

```bash
docker compose exec booking-1 npm test     # 8 test khóa ghế với Redis thật
```

## Lệnh hữu ích

```bash
docker compose logs -f payment-worker expiry-listener   # xem worker xử lý đơn, ghế hết hạn
docker compose logs -f booking-1 booking-2 booking-3
docker exec -it cinema-redis redis-cli keys 'seat:*'     # xem khóa ghế trên Redis
docker exec -it cinema-postgres psql -U cinema -c "select status, count(*) from bookings group by status"
```

## REST API

| Method | Đường dẫn | Chức năng |
| --- | --- | --- |
| POST | `/api/auth/login` | `{name}` → JWT |
| GET | `/api/movies`, `/api/movies/:id/showtimes` | Phim, suất chiếu |
| GET | `/api/showtimes/:id/seats` | Sơ đồ ghế (gộp trạng thái PostgreSQL + Redis) |
| POST | `/api/showtimes/:id/holds` | `{seatIds, holdToken?}` → 201 holdToken / 409 ghế đã có người; có holdToken thì gộp ghế vào lượt giữ đang có |
| DELETE | `/api/holds/:token/seats/:seatId` | Nhả một ghế |
| DELETE | `/api/holds/:token` | Nhả tất cả ghế |
| POST | `/api/bookings` | `{holdToken}` + header `Idempotency-Key` → 202 đơn PENDING |
| GET | `/api/bookings/:id` | Trạng thái đơn, mã vé |
| GET | `/api/admin/stats` | Số liệu dashboard |
| PUT | `/api/admin/lock`, `/api/admin/hold-ttl` | Bật/tắt khóa, đổi thời gian giữ ghế |
| POST | `/api/admin/reset` | `{showtimeId}` xóa vé/đơn/khóa của suất chiếu |

Sự kiện Socket.IO (server → client): `hello`, `seats_held`, `seats_released`, `seats_sold`, `seats_reset`, `booking_result`.
Client → server: `join_showtime`, `leave_showtime`.
