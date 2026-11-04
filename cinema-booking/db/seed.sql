-- Dữ liệu mẫu: 3 phim (tên tự đặt), 2 phòng chiếu, 6 suất chiếu.

INSERT INTO movies (title, genre, duration_min, description) VALUES
 ('Hành Tinh Cát Đỏ',        'Khoa học viễn tưởng', 148, 'Phi hành đoàn cuối cùng tìm nguồn nước trên một hành tinh sa mạc.'),
 ('Bí Mật Thành Phố Sương',  'Trinh thám',          121, 'Một thám tử trẻ lần theo chuỗi vụ mất tích trong thành phố luôn phủ sương.'),
 ('Chuyến Tàu Nửa Đêm',      'Gia đình, hoạt hình',  98, 'Hai chị em lạc lên chuyến tàu chỉ chạy lúc nửa đêm.');

-- Phòng 1: 10 × 10 = 100 ghế (dùng cho bài kiểm thử tải 5.000 request vào 100 ghế)
-- Phòng 2: 8 × 12 = 96 ghế
INSERT INTO rooms (name, rows, cols) VALUES ('Phòng 1', 10, 10), ('Phòng 2', 8, 12);

INSERT INTO seats (room_id, row_label, col_no, type)
SELECT r.id,
       chr(64 + rw),                                         -- A, B, C, ...
       c,
       CASE WHEN rw BETWEEN r.rows / 2 AND r.rows / 2 + 1 THEN 'vip' ELSE 'standard' END
FROM rooms r
CROSS JOIN LATERAL generate_series(1, r.rows) AS rw
CROSS JOIN LATERAL generate_series(1, r.cols) AS c
ORDER BY r.id, rw, c;

INSERT INTO showtimes (movie_id, room_id, start_at, price) VALUES
 (1, 1, (date_trunc('day', now() AT TIME ZONE 'Asia/Ho_Chi_Minh') + interval '1 day 19 hours') AT TIME ZONE 'Asia/Ho_Chi_Minh', 90000),
 (1, 2, (date_trunc('day', now() AT TIME ZONE 'Asia/Ho_Chi_Minh') + interval '1 day 21 hours') AT TIME ZONE 'Asia/Ho_Chi_Minh', 90000),
 (2, 1, (date_trunc('day', now() AT TIME ZONE 'Asia/Ho_Chi_Minh') + interval '2 days 18 hours') AT TIME ZONE 'Asia/Ho_Chi_Minh', 80000),
 (2, 2, (date_trunc('day', now() AT TIME ZONE 'Asia/Ho_Chi_Minh') + interval '2 days 20 hours') AT TIME ZONE 'Asia/Ho_Chi_Minh', 80000),
 (3, 1, (date_trunc('day', now() AT TIME ZONE 'Asia/Ho_Chi_Minh') + interval '3 days 9 hours') AT TIME ZONE 'Asia/Ho_Chi_Minh',  70000),
 (3, 2, (date_trunc('day', now() AT TIME ZONE 'Asia/Ho_Chi_Minh') + interval '3 days 15 hours') AT TIME ZONE 'Asia/Ho_Chi_Minh', 70000);
