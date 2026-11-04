-- Dữ liệu chính thức của hệ thống. PostgreSQL là "chốt chặn cuối cùng" chống bán trùng ghế.

CREATE TABLE movies (
    id           SERIAL PRIMARY KEY,
    title        TEXT NOT NULL,
    genre        TEXT NOT NULL,
    duration_min INT  NOT NULL,
    description  TEXT NOT NULL DEFAULT ''
);

CREATE TABLE rooms (
    id   SERIAL PRIMARY KEY,
    name TEXT NOT NULL,
    rows INT  NOT NULL,
    cols INT  NOT NULL
);

CREATE TABLE seats (
    id        SERIAL PRIMARY KEY,
    room_id   INT  NOT NULL REFERENCES rooms(id),
    row_label TEXT NOT NULL,
    col_no    INT  NOT NULL,
    type      TEXT NOT NULL DEFAULT 'standard',   -- standard | vip
    UNIQUE (room_id, row_label, col_no)
);

CREATE TABLE showtimes (
    id       SERIAL PRIMARY KEY,
    movie_id INT NOT NULL REFERENCES movies(id),
    room_id  INT NOT NULL REFERENCES rooms(id),
    start_at TIMESTAMPTZ NOT NULL,
    price    INT NOT NULL                        -- giá ghế thường (VND)
);

CREATE TABLE bookings (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         TEXT NOT NULL,
    showtime_id     INT  NOT NULL REFERENCES showtimes(id),
    seat_ids        INT[] NOT NULL,
    hold_token      TEXT NOT NULL,
    status          TEXT NOT NULL DEFAULT 'PENDING',  -- PENDING | PAID | FAILED
    total           INT  NOT NULL,
    code            TEXT,                             -- mã đặt vé khi PAID
    error           TEXT,
    served_by       TEXT,                             -- server đã nhận đơn (để demo)
    idempotency_key TEXT NOT NULL UNIQUE,             -- chống xử lý 1 đơn 2 lần
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE tickets (
    id          SERIAL PRIMARY KEY,
    booking_id  UUID NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
    showtime_id INT  NOT NULL REFERENCES showtimes(id),
    seat_id     INT  NOT NULL REFERENCES seats(id),
    -- LỚP BẢO VỆ THỨ HAI: một ghế của một suất chiếu chỉ có tối đa một vé
    CONSTRAINT uq_ticket_seat UNIQUE (showtime_id, seat_id)
);

CREATE INDEX idx_bookings_showtime ON bookings(showtime_id);
