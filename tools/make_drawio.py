"""Sinh docs/so-do-du-an.drawio: 3 sơ đồ đơn giản, đen trắng, vẽ theo chiều ngang.

Chạy:  python tools/make_drawio.py docs/so-do-du-an.drawio
"""
import sys
from xml.sax.saxutils import quoteattr

BASE = "whiteSpace=wrap;html=1;fillColor=#ffffff;strokeColor=#000000;fontColor=#000000;fontSize=12;"
STYLE = {
    "term": "rounded=1;arcSize=50;" + BASE,                       # bắt đầu / kết thúc
    "proc": "rounded=0;" + BASE,                                  # bước xử lý
    "dec": "rhombus;" + BASE,                                     # điều kiện
    "group": "rounded=0;dashed=1;verticalAlign=top;" + BASE.replace("fillColor=#ffffff", "fillColor=none"),
    "note": "rounded=0;dashed=1;" + BASE,
    "lanehead": "rounded=0;fontStyle=1;" + BASE,
    "lane": "rounded=0;" + BASE.replace("fillColor=#ffffff", "fillColor=none"),
    "title": "text;html=1;fontSize=16;fontStyle=1;align=left;verticalAlign=middle;fontColor=#000000;",
}
EDGE = ("edgeStyle=orthogonalEdgeStyle;rounded=0;orthogonalLoop=1;jettySize=auto;html=1;"
        "endArrow=classic;strokeColor=#000000;fontColor=#000000;fontSize=11;labelBackgroundColor=#ffffff;")


class Page:
    def __init__(self, name, width, height):
        self.name, self.width, self.height = name, width, height
        self.cells, self.n = [], 1

    def box(self, kind, x, y, w, h, label):
        self.n += 1
        cid = f"c{self.n}"
        self.cells.append(
            f'<mxCell id="{cid}" value={quoteattr(label)} style="{STYLE[kind]}" vertex="1" parent="1">'
            f'<mxGeometry x="{x}" y="{y}" width="{w}" height="{h}" as="geometry"/></mxCell>')
        return cid

    def edge(self, src, dst, label="", exit=None, entry=None, points=(), dashed=False):
        style = EDGE
        if exit:
            style += f"exitX={exit[0]};exitY={exit[1]};exitDx=0;exitDy=0;"
        if entry:
            style += f"entryX={entry[0]};entryY={entry[1]};entryDx=0;entryDy=0;"
        if dashed:
            style += "dashed=1;"
        pts = "".join(f'<mxPoint x="{px}" y="{py}"/>' for px, py in points)
        geo = (f'<mxGeometry relative="1" as="geometry"><Array as="points">{pts}</Array></mxGeometry>'
               if pts else '<mxGeometry relative="1" as="geometry"/>')
        self.n += 1
        self.cells.append(
            f'<mxCell id="c{self.n}" value={quoteattr(label)} style="{style}" edge="1" parent="1" '
            f'source="{src}" target="{dst}">{geo}</mxCell>')

    def xml(self, idx):
        return (f'<diagram name={quoteattr(self.name)} id="page{idx}"><mxGraphModel grid="1" gridSize="10" '
                f'guides="1" tooltips="1" connect="1" arrows="1" fold="1" page="1" pageScale="1" '
                f'pageWidth="{self.width}" pageHeight="{self.height}" math="0" shadow="0"><root>'
                f'<mxCell id="0"/><mxCell id="1" parent="0"/>{"".join(self.cells)}</root></mxGraphModel></diagram>')


def row(p, cy, items, x0=20, gap=60):
    """Đặt các hình thành một hàng ngang, căn giữa theo cy. items = [(kind, w, h, label), ...]"""
    ids, x = [], x0
    for kind, w, h, label in items:
        ids.append(p.box(kind, x, cy - h // 2, w, h, label))
        x += w + gap
    return ids


# ---------------- 1. LƯU ĐỒ ĐẶT VÉ (chia làn theo thành phần) ----------------
LANES = ["Trình duyệt<br>(khách hàng)", "Booking Server<br>(1, 2, 3)", "Redis",
         "RabbitMQ +<br>Payment Worker", "PostgreSQL"]
LANE_TOP, LANE_H, COL0, COL_W = 110, 140, 230, 180


def cx(col):
    return COL0 + col * COL_W


def cy(lane):
    return LANE_TOP + lane * LANE_H + LANE_H // 2


def put(p, kind, col, lane, label):
    w, h = {"dec": (130, 80), "term": (110, 44)}.get(kind, (140, 60))
    return p.box(kind, cx(col) - w // 2, cy(lane) - h // 2, w, h, label)


def flowchart():
    ncol = 15
    width = cx(ncol - 1) + 110
    p = Page("1. Lưu đồ đặt vé", width, LANE_TOP + len(LANES) * LANE_H + 20)
    p.box("title", 20, 5, 900, 30, "Lưu đồ đặt vé – mỗi làn là một thành phần, bước nằm ở làn nào thì chạy ở đó")
    for i, name in enumerate(LANES):  # vẽ làn trước để các ô nằm đè lên trên
        y = LANE_TOP + i * LANE_H
        p.box("lanehead", 20, y, 130, LANE_H, name)
        p.box("lane", 150, y, width - 170, LANE_H, "")

    start = put(p, "term", 0, 0, "Bắt đầu")
    pick = put(p, "proc", 1, 0, "Đăng nhập, chọn suất chiếu")
    click = put(p, "proc", 2, 0, "Bấm chọn ghế<br>(tối đa 8 ghế)")
    merge = put(p, "proc", 2, 1, "Gộp ghế vào lượt giữ (holdToken)")
    lua = put(p, "proc", 2, 2, "Lua: ghế trống thì khóa, TTL 5 phút (chạy nguyên khối)")
    d_lock = put(p, "dec", 3, 1, "Khóa được?")
    taken = put(p, "proc", 3, 0, "Báo: ghế đã có người chọn")
    emit = put(p, "proc", 4, 1, "Phát sự kiện “ghế đang giữ”")
    pubsub = put(p, "proc", 4, 2, "Redis Pub/Sub chuyển tới cả 3 server")
    seen = put(p, "proc", 5, 0, "Mọi trình duyệt thấy ghế chuyển vàng")
    d_more = put(p, "dec", 6, 0, "Chọn thêm / bỏ ghế?")
    pay = put(p, "proc", 7, 0, "Bấm Thanh toán")
    idem = put(p, "proc", 7, 1, "Kiểm tra Idempotency-Key (gửi trùng → trả đơn cũ)")
    verify = put(p, "proc", 7, 2, "Kiểm tra lượt giữ còn hạn, gia hạn thêm")
    d_valid = put(p, "dec", 8, 1, "Còn hạn?")
    expired = put(p, "proc", 8, 0, "Báo hết giờ, ghế đã nhả")
    put(p, "note", 8, 2, "Hết 5 phút chưa trả: khóa tự xóa → Expiry Listener báo ghế trống")
    pending = put(p, "proc", 9, 4, "Ghi đơn PENDING")
    queue = put(p, "proc", 10, 3, "Gửi job vào hàng đợi payments")
    work = put(p, "proc", 11, 3, "Worker lấy job, thanh toán giả lập")
    ticket = put(p, "proc", 11, 4, "Ghi vé trong 1 transaction (UNIQUE chặn trùng)")
    d_ok = put(p, "dec", 12, 3, "Thành công?")
    show = put(p, "proc", 12, 0, "ACK job, hiện mã vé")
    end = put(p, "term", 13, 0, "Kết thúc")
    retry = put(p, "proc", 13, 3, "Thử lại tối đa 3 lần, rồi vào DLQ")
    failed = put(p, "proc", 14, 0, "Đơn thất bại, nhả ghế")

    down, up = dict(exit=(0.5, 1), entry=(0.5, 0)), dict(exit=(0.5, 0), entry=(0.5, 1))
    p.edge(start, pick)
    p.edge(pick, click)
    p.edge(click, merge, **down)
    p.edge(merge, lua, **down)
    p.edge(lua, d_lock, exit=(1, 0.5), entry=(0.5, 1), points=[(cx(3), cy(2))])
    p.edge(d_lock, taken, "Không", **up)
    p.edge(d_lock, emit, "Có")
    p.edge(emit, pubsub, **down)
    gx = cx(4) + 90  # đi theo khe giữa hai cột
    p.edge(pubsub, seen, exit=(1, 0.5), entry=(0, 0.5), points=[(gx, cy(2)), (gx, cy(0))])
    p.edge(seen, d_more)
    p.edge(d_more, pay, "Không")
    p.edge(pay, idem, **down)
    p.edge(idem, verify, **down)
    gx = cx(7) + 90
    p.edge(verify, d_valid, exit=(1, 0.5), entry=(0, 0.5), points=[(gx, cy(2)), (gx, cy(1))])
    p.edge(d_valid, expired, "Không", **up)
    p.edge(d_valid, pending, "Có", exit=(1, 0.5), entry=(0.5, 0), points=[(cx(9), cy(1))])
    p.edge(pending, queue, exit=(1, 0.5), entry=(0.5, 1), points=[(cx(10), cy(4))])
    p.edge(queue, work)
    p.edge(work, ticket, **down)
    p.edge(ticket, d_ok, exit=(1, 0.5), entry=(0.5, 1), points=[(cx(12), cy(4))])
    p.edge(d_ok, show, "Có", **up)
    p.edge(show, end)
    p.edge(d_ok, retry, "Không")
    p.edge(retry, failed, exit=(1, 0.5), entry=(0.5, 1), points=[(cx(14), cy(3))])
    # các đường quay về "Bấm chọn ghế" chạy phía trên cùng, mỗi đường một độ cao
    for src_id, col, y, fx, label in [(taken, 3, 95, 0.8, "chọn lại"), (d_more, 6, 80, 0.6, "Có"),
                                      (expired, 8, 65, 0.4, "chọn lại"), (failed, 14, 50, 0.2, "chọn lại")]:
        p.edge(src_id, click, label, exit=(0.5, 0), entry=(fx, 0),
               points=[(cx(col), y), (cx(2) - 70 + int(140 * fx), y)])
    return p


# ---------------- 2. LUỒNG NGƯỜI DÙNG ----------------
def user_flow():
    p = Page("2. Luồng người dùng", 1720, 380)
    p.box("title", 20, 0, 400, 30, "Luồng người dùng qua các màn hình")
    # khoảng cách 100 để nhãn trên mũi tên (vd. "chọn giờ chiếu") không đè lên ô
    start, login, movies, seats, paying, d_res, ticket, end = row(p, 160, gap=100, items=[
        ("term", 110, 40, "Mở trang web"),
        ("proc", 130, 50, "Trang đăng nhập"),
        ("proc", 130, 50, "Danh sách phim"),
        ("proc", 130, 50, "Trang chọn ghế"),
        ("proc", 130, 50, "Đang xử lý thanh toán"),
        ("dec", 110, 80, "Kết quả?"),
        ("proc", 130, 50, "Trang vé (mã đặt vé)"),
        ("term", 100, 40, "Kết thúc"),
    ])
    note = p.box("proc", 670, 40, 170, 60, "Bấm ghế: giữ ngay<br>Bấm lại: bỏ ghế<br>Hết giờ: ghế tự nhả")
    dash = p.box("proc", 460, 270, 130, 50, "Dashboard")

    p.edge(start, login)
    p.edge(login, movies, "nhập tên")
    p.edge(movies, seats, "chọn giờ chiếu")
    p.edge(seats, paying, "bấm Thanh toán")
    p.edge(paying, d_res)
    p.edge(d_res, ticket, "thành công")
    p.edge(ticket, end)
    p.edge(d_res, seats, "thất bại", exit=(0.5, 1), entry=(0.5, 1), points=[(1205, 240), (755, 240)])
    p.edge(seats, note, exit=(0.5, 0), entry=(0.5, 1), dashed=True)
    p.edge(movies, dash, "menu", exit=(0.3, 1), entry=(0.3, 0))
    p.edge(dash, movies, "menu", exit=(0.7, 0), entry=(0.7, 1))
    return p


# ---------------- 3. KIẾN TRÚC ----------------
def architecture():
    p = Page("3. Kiến trúc", 1280, 440)
    p.box("title", 20, 0, 600, 30, "Kiến trúc hệ thống (9 container)")
    browser = p.box("proc", 20, 190, 120, 60, "Trình duyệt")
    nginx = p.box("proc", 210, 180, 140, 80, "Nginx<br>cân bằng tải,<br>bỏ qua server chết")
    g_book = p.box("group", 420, 40, 180, 360, "Booking Server<br>(stateless, cùng code)")
    b1 = p.box("proc", 440, 90, 140, 60, "Booking 1<br>Express + Socket.IO")
    b2 = p.box("proc", 440, 190, 140, 60, "Booking 2<br>Express + Socket.IO")
    b3 = p.box("proc", 440, 290, 140, 60, "Booking 3<br>Express + Socket.IO")
    redis = p.box("proc", 820, 80, 170, 80, "Redis<br>khóa ghế (TTL), Pub/Sub,<br>nhịp tim, cấu hình")
    pg = p.box("proc", 820, 190, 170, 60, "PostgreSQL<br>phim, đơn, vé (UNIQUE)")
    mq = p.box("proc", 820, 280, 170, 80, "RabbitMQ<br>payments +<br>payments.dlq")
    expiry = p.box("proc", 1080, 80, 170, 80, "Expiry Listener<br>báo ghế trống qua Redis")
    worker = p.box("proc", 1080, 280, 170, 80, "Payment Worker<br>ghi vé, báo kết quả qua Redis")

    p.edge(browser, nginx, "HTTP + WebSocket")
    p.edge(nginx, b1, exit=(1, 0.5), entry=(0, 0.5), points=[(385, 220), (385, 120)])
    p.edge(nginx, b2, "chia đều")
    p.edge(nginx, b3, exit=(1, 0.5), entry=(0, 0.5), points=[(385, 220), (385, 320)])
    p.edge(g_book, redis, "khóa ghế, Pub/Sub, nhịp tim", exit=(1, 0.222), entry=(0, 0.5))
    p.edge(g_book, pg, "đọc phim, ghi đơn", exit=(1, 0.5), entry=(0, 0.5))
    p.edge(g_book, mq, "gửi job thanh toán", exit=(1, 0.778), entry=(0, 0.5))
    p.edge(redis, expiry, "khóa hết hạn")
    p.edge(mq, worker, "lấy job, ACK")
    p.edge(worker, pg, "ghi vé", exit=(0.5, 0), entry=(1, 0.5), points=[(1165, 220)])
    return p


pages = [flowchart(), user_flow(), architecture()]
xml = '<mxfile host="app.diagrams.net" type="device">' + "".join(pg.xml(i) for i, pg in enumerate(pages, 1)) + "</mxfile>"
open(sys.argv[1], "w", encoding="utf-8").write(xml)
print("saved", sys.argv[1])
