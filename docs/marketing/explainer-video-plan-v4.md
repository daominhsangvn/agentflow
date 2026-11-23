# Kế hoạch motion video giới thiệu AgentFlow · v4 (1:23)

> Bản v4, 2026-11-23, để review. Animatic: [`video-draft-v4/`](video-draft-v4/) (mở `index.html`, hoặc xem `out/*.mp4`).
> v3.1 ([`explainer-video-plan-v3.md`](explainer-video-plan-v3.md), [`video-draft-v3/`](video-draft-v3/)) giữ nguyên. Phần kiểm chứng nội dung (mục 5 của v3) vẫn áp dụng cho các cảnh hoạt hình.

## 0. Tóm tắt

| | |
|---|---|
| Độ dài | **1:23** (82.7 giây), 12 cảnh: 7 cảnh hoạt hình, 5 cảnh giao diện thật của app |
| Mục tiêu | Giới thiệu các tính năng tiêu biểu và bài toán AgentFlow giải quyết. LD-6 chỉ là ví dụ ngắn (C3, C4, C7), không phải trọng tâm |
| Âm thanh | **Không có giọng đọc.** Nhạc nền tự tạo chạy suốt, đổi đoạn ở C2, U1, C8, C9 |
| Chữ | Mỗi cảnh một dòng chữ lớn (EN hoặc VI) thay cho lời đọc |
| Giao diện thật | Connections, Workflows, Agents, Runs, Home của app, dữ liệu mẫu (org Acme). Mỗi clip có chuyển động bên trong trang, không chỉ là ảnh tĩnh phóng to |
| Câu kết | **Agents do the work. AgentFlow coordinates.** (logo) |

## 1. Thay đổi so với v3.1

- Bỏ giọng đọc theo yêu cầu review; chữ trên hình to hơn, mỗi cảnh một câu.
- Bỏ C5 (Plan and build) và C6 (Test and fix): phần ví dụ LD-6 không còn đi qua từng bước.
- Thêm 5 cảnh giao diện thật (U1–U5), xen giữa các cảnh hoạt hình.

## 2. Cấu trúc

| Cảnh | Thời điểm | Loại | Chữ trên hình (EN) |
|---|---|---|---|
| C1 | 0:00–0:08 | Hoạt hình | AI agents can write requirements, code and tests. But people still carry the work between them. |
| C2 | 0:08–0:16 | Hoạt hình | AgentFlow takes over: it connects your tools and coordinates your agents, on your own machines. |
| U1 | 0:16–0:21 | App · Connections | Connect the tools your team already uses |
| U2 | 0:21–0:27 | App · Workflows | Work starts on its own: a ticket moves, someone mentions the bot |
| C3 | 0:27–0:33 | Hoạt hình | Your rules pick the right agent and the right command |
| C4 | 0:33–0:44 | Hoạt hình | Questions go to the right person, in Jira or chat. AgentFlow records the answer. |
| U3 | 0:44–0:50 | App · Agents | Your agents run on your own machines, in parallel |
| U4 | 0:50–0:55 | App · Runs | Every run, every result, every pull request |
| C7 | 0:55–0:59 | Hoạt hình | Agents never merge. People do. |
| C8 | 0:59–1:11 | Hoạt hình | Many projects, day and night, started by a ticket, an email or a schedule |
| U5 | 1:11–1:16 | App · Home | See what needs you, at a glance |
| C9 | 1:16–1:23 | Logo | |

Bản tiếng Việt: `tools/script.json`, trường `vi`.

## 3. Cảnh giao diện thật

Mỗi clip dài 5 giây, quay từ app thật bằng `tools/ui-clip.mjs`, đặt trong khung trình duyệt có địa chỉ `app.acme.example/<trang>`.

| Clip | Chuyển động |
|---|---|
| U1 Connections | Jira, Microsoft Teams, Azure DevOps lần lượt hiện ra, trạng thái từ "Checking" sang Active; "Last delivery" của Jira thành "just now"; con trỏ bấm "Test" |
| U2 Workflows | Chip trigger sáng lên lần lượt: Jira (LeaveDesk Delivery), Teams (Policy Q&A), Azure DevOps (UI tests); số case và "open" tăng, "Last run" thành "just now"; con trỏ tới "New workflow" |
| U3 Agents | 12 agent lần lượt chuyển Online, ô đếm từ "9 online" lên "21 online"; health của QC · Testing thành Passed |
| U4 Runs | Một run từ Teams và một run từ Jira (LD-15) xuất hiện ở đầu bảng; LD-14 chuyển Running → Succeeded và có PR `leavedesk-app #7`; các ô đếm tăng theo; run DATA-5 "Needs input" nhấp nháy; con trỏ bấm vào PR |
| U5 Home | Số liệu Attention đếm lên, 4 việc "Needs attention" lần lượt hiện ra (LD-12, PAY-7, DATA-5, MOB-33); con trỏ tới LD-12 |

Trong video, mỗi clip có thêm "camera" (`UI_CAMERA` trong `js/scenes.js`): mở đầu thấy cả trang, rồi zoom vào chỗ đang chuyển động và đi theo con trỏ, để chữ đủ lớn khi xem trên điện thoại. Cảnh Home chỉ khung thẻ Attention; biểu đồ bên dưới (tính theo token) không lọt vào hình.

Nguyên tắc của các clip:

- Chỉ dùng tính năng đã có trong code. Trigger trên clip chỉ là Jira, Azure DevOps, Teams và webhook; không có Slack, Zalo, email hay lịch.
- Không lộ dữ liệu thật: tên người, email, tên project và org thật đều được thay bằng dữ liệu mẫu (Acme, LeaveDesk, Payments...).
- Không có chữ "runner" trong khung hình.
- Không nhấn vào chi phí hay số token.
- Quay ở chế độ chỉ đọc: mọi request không phải GET đều bị chặn.

## 4. Kiểm chứng nội dung

- Cảnh hoạt hình C1–C4, C7, C8 dùng bảng ở mục 5 của plan v3. Slack, Zalo, Telegram, WhatsApp, trigger email và trigger theo lịch vẫn **chưa có trong code**, nên C4 và C8 phải đổi theo phương án thay thế ở đó nếu công bố trước khi các tính năng này ra mắt.
- Cảnh giao diện là các trang có thật của app; dữ liệu trên đó là dữ liệu mẫu.

## 5. Quyết định cần chốt

| # | Câu hỏi | Đề xuất |
|---|---|---|
| 1 | Các tính năng chưa có trong code ở C4, C8 | Như v3 mục 6 #1 |
| 2 | Ghi chú "dữ liệu mẫu" cho các cảnh giao diện | Thêm một dòng nhỏ "Demo data" ở góc khung trình duyệt nếu công bố rộng |
| 3 | Địa chỉ trên thanh trình duyệt (`app.acme.example`) | Đổi thành domain thật khi chốt CTA |
| 4 | CTA và URL ở C9 | Như v3 mục 6 #2 |
| 5 | Nhạc | Nhạc tự tạo dùng được; nếu muốn nhạc có license thì truyền `--music=<file>` cho `make-mp4.mjs` |
