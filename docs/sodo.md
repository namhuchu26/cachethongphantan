# Diễn giải 3 sơ đồ của dự án CinemaDS

Tài liệu này giải thích 3 sơ đồ trong file `docs/so-do-du-an.drawio`. Mỗi sơ đồ nằm ở một trang (tab) riêng. Mở file tại https://app.diagrams.net bằng File → Open from → Device.

| Trang | Sơ đồ | Trả lời câu hỏi |
| --- | --- | --- |
| 1 | Lưu đồ đặt vé | Một lượt đặt vé đi qua những bước nào, bước nào chạy ở thành phần nào? |
| 2 | Luồng người dùng | Người dùng đi qua những màn hình nào? |
| 3 | Kiến trúc hệ thống | Hệ thống gồm những thành phần nào, nối với nhau ra sao? |

Quy ước chung của cả 3 sơ đồ:

- **Hình chữ nhật bo tròn:** bắt đầu hoặc kết thúc.
- **Hình chữ nhật:** một bước xử lý hoặc một thành phần.
- **Hình thoi:** câu hỏi có hai nhánh Có / Không.
- **Mũi tên liền:** thứ tự thực hiện, hoặc dữ liệu đi từ đâu tới đâu.
- **Ô hoặc đường nét đứt:** ghi chú, hoặc khung nhóm các thành phần.

## 1. Lưu đồ đặt vé

### 1.1. Cách đọc

Sơ đồ đọc từ trái sang phải. Sơ đồ chia thành 5 làn ngang, mỗi làn là một thành phần của hệ thống. Bước nằm ở làn nào thì do thành phần đó thực hiện. Nhìn vào là thấy một lượt đặt vé phải đi qua nhiều máy khác nhau, đây là điểm chính của hệ phân tán.

| Làn | Vai trò |
| --- | --- |
| Trình duyệt (khách hàng) | Khách bấm, xem kết quả |
| Booking Server (1, 2, 3) | Nhận yêu cầu, kiểm tra và quyết định |
| Redis | Khóa ghế, chuyển sự kiện giữa các server |
| RabbitMQ + Payment Worker | Xếp hàng và xử lý thanh toán |
| PostgreSQL | Lưu đơn và vé |

### 1.2. Giai đoạn 1 – Giữ ghế

1. **Bắt đầu → Đăng nhập, chọn suất chiếu** (Trình duyệt).
2. **Bấm chọn ghế**, tối đa 8 ghế (Trình duyệt).
3. **Gộp ghế vào lượt giữ (holdToken)** (Booking Server). Mỗi khách có một lượt giữ, giống một giỏ hàng: bấm thêm ghế thì ghế được bỏ vào cùng giỏ, và tất cả ghế hết hạn cùng lúc.
4. **Lua: ghế trống thì khóa, TTL 5 phút** (Redis). Redis chạy script Lua nguyên khối, nên bước "kiểm tra ghế trống" và bước "khóa ghế" không bị request khác chen vào giữa.
5. **Khóa được?** (Booking Server). Không → **Báo: ghế đã có người chọn**, khách chọn lại. Có → đi tiếp.

### 1.3. Giai đoạn 2 – Báo cho mọi người

6. **Phát sự kiện "ghế đang giữ"** (Booking Server).
7. **Redis Pub/Sub chuyển tới cả 3 server** (Redis). Mỗi server đẩy sự kiện xuống các trình duyệt đang nối với nó qua WebSocket.
8. **Mọi trình duyệt thấy ghế chuyển vàng** (Trình duyệt), kể cả khách đang nối vào server khác.
9. **Chọn thêm / bỏ ghế?** (Trình duyệt). Có → quay lại bước "Bấm chọn ghế". Không → đi tiếp.

### 1.4. Giai đoạn 3 – Thanh toán

10. **Bấm Thanh toán** (Trình duyệt).
11. **Kiểm tra Idempotency-Key** (Booking Server). Mỗi lần thanh toán có một mã riêng. Nếu yêu cầu bị gửi trùng, server trả lại đơn cũ chứ không tạo đơn mới.
12. **Kiểm tra lượt giữ còn hạn, gia hạn thêm** (Redis).
13. **Còn hạn?** (Booking Server). Không → **Báo hết giờ, ghế đã nhả**, khách chọn lại. Có → đi tiếp.

Ô ghi chú nét đứt ở làn Redis giải thích vì sao lượt giữ hết hạn. Nếu khách không trả tiền trong 5 phút, khóa trên Redis tự xóa. Expiry Listener nghe sự kiện hết hạn đó và báo mọi trình duyệt rằng ghế đã trống.

### 1.5. Giai đoạn 4 – Ghi vé

14. **Ghi đơn PENDING** (PostgreSQL). Đơn ở trạng thái đang chờ xử lý.
15. **Gửi job vào hàng đợi payments** (RabbitMQ). Hàng đợi lưu trên đĩa, nên Worker chết thì job vẫn còn. Booking Server không phải chờ thanh toán xong.
16. **Worker lấy job, thanh toán giả lập** (Payment Worker).
17. **Ghi vé trong 1 transaction, UNIQUE chặn trùng** (PostgreSQL). Đây là lớp bảo vệ thứ hai: nếu khóa Redis có sai sót, database vẫn không cho hai vé cùng một ghế.
18. **Thành công?** (Payment Worker). Có → **ACK job, hiện mã vé** → **Kết thúc**. Không → **Thử lại tối đa 3 lần, rồi vào DLQ** → **Đơn thất bại, nhả ghế**, khách chọn lại.

ACK là tín hiệu Worker gửi cho RabbitMQ: "đã xử lý xong, xóa job đi". Worker chỉ gửi ACK sau khi đã ghi vé xong. DLQ (`payments.dlq`) là hàng chờ chứa các job lỗi quá 3 lần, để người quản trị xem lại.

### 1.6. Bốn đường quay lại

Bốn đường "chọn lại" chạy ở phía trên cùng sơ đồ, đều quay về bước "Bấm chọn ghế".

| Từ đâu | Lý do |
| --- | --- |
| Khóa được? → Không | Ghế đã có người khác giữ |
| Chọn thêm / bỏ ghế? → Có | Khách muốn đổi hoặc thêm ghế |
| Còn hạn? → Không | Quá 5 phút chưa thanh toán |
| Đơn thất bại | Thanh toán hoặc ghi vé bị lỗi |

### 1.7. Ý nghĩa với môn học

| Bước trên sơ đồ | Kiến thức hệ phân tán |
| --- | --- |
| Lua khóa ghế trên Redis | Loại trừ tương hỗ tập trung, Redis là bên điều phối |
| Khóa có TTL, Expiry Listener | Khóa có thời hạn (lease), tránh khóa bị treo khi khách bỏ đi |
| Redis Pub/Sub tới 3 server | Đồng bộ trạng thái giữa các server, tính trong suốt |
| Hàng đợi payments + ACK | Giao tiếp bất đồng bộ, giao tin "ít nhất một lần" |
| Idempotency-Key | Xử lý trùng lặp, kết hợp với "ít nhất một lần" thành "đúng một lần" |
| UNIQUE trong PostgreSQL | Lớp bảo vệ thứ hai, không phụ thuộc hoàn toàn vào khóa |
| Thử lại 3 lần, DLQ | Chịu lỗi khi xử lý thất bại |

## 2. Luồng người dùng

### 2.1. Cách đọc

Sơ đồ này không nói về máy chủ, chỉ nói về **các màn hình người dùng nhìn thấy** và thao tác để chuyển từ màn hình này sang màn hình khác. Chữ trên mũi tên là thao tác của người dùng.

### 2.2. Các bước

1. **Mở trang web** (http://localhost:8080).
2. **Trang đăng nhập.** Người dùng **nhập tên** (không cần mật khẩu) và nhận JWT.
3. **Danh sách phim.** Người dùng xem phim và **chọn giờ chiếu**.
4. **Trang chọn ghế.** Người dùng chọn ghế rồi **bấm Thanh toán**.
5. **Đang xử lý thanh toán.** Trang chờ kết quả từ Worker, được đẩy về qua WebSocket.
6. **Kết quả?** Thành công → **Trang vé (mã đặt vé)** → **Kết thúc**. Thất bại → quay về **Trang chọn ghế**.

### 2.3. Ô ghi chú ở trang chọn ghế

Ô ghi chú nối với "Trang chọn ghế" bằng nét đứt, tóm tắt cách thao tác trên sơ đồ ghế:

- **Bấm ghế: giữ ngay.** Không cần bấm thêm nút xác nhận, ghế được khóa luôn và người khác thấy ngay.
- **Bấm lại: bỏ ghế.** Bấm vào ghế mình đang giữ thì ghế được nhả.
- **Hết giờ: ghế tự nhả.** Quá thời gian giữ (mặc định 5 phút) mà chưa thanh toán thì ghế tự trả lại.

### 2.4. Dashboard

**Dashboard** nối hai chiều với "Danh sách phim" qua **menu**. Đây là trang dùng khi demo:

- Xem server nào sống, server nào chết.
- Bật hoặc tắt khóa.
- Đổi thời gian giữ ghế.
- Xem số liệu và sơ đồ ghế realtime.
- Xem log sự kiện.

## 3. Kiến trúc hệ thống

### 3.1. Cách đọc

Request đi từ trái sang phải. Hệ thống gồm 9 container chạy bằng Docker Compose. Khung nét đứt "Booking Server" nhóm 3 server giống hệt nhau. Chữ trên mũi tên cho biết hai thành phần trao đổi gì.

### 3.2. Các thành phần

| Thành phần | Vai trò |
| --- | --- |
| Trình duyệt | Giao diện người dùng, gửi HTTP (REST) và giữ kết nối WebSocket |
| Nginx | Cân bằng tải: chia request đều cho 3 server, tự bỏ qua server chết |
| Booking 1, 2, 3 | Cùng một code (Express + Socket.IO), stateless: không giữ dữ liệu riêng |
| Redis | Khóa ghế (có TTL), Pub/Sub giữa các server, nhịp tim, cấu hình dùng chung |
| PostgreSQL | Phim, suất chiếu, ghế, đơn, vé; ràng buộc UNIQUE chặn bán trùng |
| RabbitMQ | Hàng đợi `payments` và hàng chờ lỗi `payments.dlq` |
| Expiry Listener | Nghe sự kiện khóa hết hạn của Redis, báo trình duyệt ghế trống |
| Payment Worker | Lấy job, thanh toán giả lập, ghi vé, báo kết quả |

### 3.3. Các kết nối

| Mũi tên | Nội dung |
| --- | --- |
| Trình duyệt → Nginx | HTTP + WebSocket |
| Nginx → Booking 1, 2, 3 | Chia đều (round-robin) |
| Booking → Redis | Khóa ghế, Pub/Sub, nhịp tim |
| Booking → PostgreSQL | Đọc phim, ghi đơn |
| Booking → RabbitMQ | Gửi job thanh toán |
| Redis → Expiry Listener | Khóa hết hạn |
| RabbitMQ → Payment Worker | Lấy job, ACK |
| Payment Worker → PostgreSQL | Ghi vé |

### 3.4. Ý nghĩa với môn học

- **Nhân bản server và stateless.** Các Booking Server không giữ dữ liệu riêng mà dùng chung Redis và PostgreSQL. Vì vậy một server chết thì Nginx chuyển khách sang server khác mà không mất gì (kịch bản D4).
- **Phát hiện lỗi bằng nhịp tim.** Mỗi server ghi nhịp tim lên Redis 2 giây một lần, với TTL 6 giây. Hết nhịp tim nghĩa là server đã chết.
- **Các server phối hợp qua trung gian.** Booking Server không nói chuyện trực tiếp với nhau, mà qua Redis (khóa, Pub/Sub) và RabbitMQ (hàng đợi).
- **Tách xử lý chậm ra khỏi đường chính.** Thanh toán chạy ở Payment Worker, nên Booking Server trả lời khách nhanh, và Worker chết thì job vẫn chờ trong hàng đợi (kịch bản D5).
- **Hạn chế.** Redis, PostgreSQL, RabbitMQ và Nginx mỗi thứ chỉ có một bản, nên mỗi thứ là một điểm chết duy nhất. Bản thật cần nhân bản các thành phần này.
