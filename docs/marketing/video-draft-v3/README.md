# Animatic nháp v3: video giới thiệu AgentFlow (1:07)

Animatic chạy trong trình duyệt, dựng theo [`../explainer-video-plan-v3.md`](../explainer-video-plan-v3.md): 9 cảnh, 1:07 (66.7 giây theo lời đọc tạm). Bản này để duyệt nhịp, bố cục, lời thoại và nhạc trước khi làm motion thật, chưa phải video hoàn chỉnh. Bản v2 (18 cảnh, khoảng 2:23) vẫn giữ nguyên ở [`../video-draft/`](../video-draft/).

## Khác v2

- **Gọn còn 9 cảnh**: các cảnh của v2 được gộp lại, thông điệp giữ nguyên (mục 1 của plan v3).
- **C4 · Hỏi người ngay nơi họ trao đổi**: câu hỏi của agent BA đi tới comment trên Jira và thread chat. Thread lướt qua Teams, Slack, Zalo, Telegram, WhatsApp. Trên chat, người được hỏi nhận thông báo vì bị @mention (comment Jira thì không @mention ai). Người được hỏi trả lời rồi xác nhận, AgentFlow ghi nhận và chuyển sang bước tiếp.
- **C8 · Nhiều project, cả ngày lẫn đêm**:
  - 9 project, mỗi project hàng chục workflow, chạy song song;
  - một đồng hồ 24/7 chạy tua nhanh;
  - workflow bắt đầu từ một ticket, một email hoặc theo lịch (ví dụ Nightly audit, 02:00 mỗi ngày);
  - cảnh kết bằng bảng "Needs attention": những việc đang chờ người.
- **v3.1**:
  - lời đọc đơn giản hơn;
  - phần ví dụ LD-6 (C3–C7) ngắn lại từ 52 giây còn 33 giây (bỏ cảnh guard chặn command, bảng lịch sử, một tin nhắn trong thread);
  - thêm nhạc nền.

> Slack, Zalo, Telegram, WhatsApp, workflow bắt đầu từ email và workflow chạy theo lịch **chưa có trong code** (2026-11-21). Theo quyết định review, video hiện chúng như đã có. Đọc mục 5 của plan v3 trước khi công bố.

## Xem

Mở `index.html` bằng Chrome hoặc Edge (double-click là được, không cần server).

| Điều khiển | Tác dụng |
|---|---|
| ▶ Play, thanh tua | Phát, dừng, tua |
| `VO` | Bật/tắt lời đọc tạm (chỉ có tiếng Anh) |
| `♪` | Bật/tắt nhạc nền |
| `CC` | Bật/tắt phụ đề |
| `EN → VI` | Đổi ngôn ngữ chữ trên hình và phụ đề |
| `C1` … `C9` | Nhảy tới đầu cảnh |
| Space · ← / → · Home | Phát/dừng · lùi/tiến 3 giây · về đầu |

Tham số URL: `?lang=vi` (tiếng Việt), `?t=48.7` (mở ở giây 48.7), `?vo=0` (tắt lời đọc), `?music=0` (tắt nhạc).
Bản tiếng Việt tắt sẵn lời đọc, vì giọng tạm chỉ có tiếng Anh; bấm `VO` nếu vẫn muốn nghe. Phụ đề là kịch bản VI.

Mốc nên xem: `?t=21.9` (C4, hỏi trên Jira và các ứng dụng chat), `?t=48.7` (C8, nhiều project và đồng hồ 24/7).

## Video MP4

`out/agentflow-explainer-en.mp4` (lời đọc tạm + nhạc) và `out/agentflow-explainer-vi.mp4` (chỉ nhạc) là bản 1920×1080, 30 fps, phụ đề in trên hình. Làm hai bước:

```bash
node tools/render-webm.mjs --lang=en      # khung hình → out/*.webm (không tiếng), khoảng 3 phút mỗi bản
node tools/render-webm.mjs --lang=vi
node tools/make-mp4.mjs                   # out/*.webm + lời đọc + nhạc → out/*.mp4
```

- `render-webm.mjs` render từng khung hình (khung nào cũng chính xác, không phụ thuộc tốc độ máy) bằng ffmpeg đi kèm Playwright. Bản ffmpeg này chỉ xuất được WebM.
- `make-mp4.mjs` cần ffmpeg bản đầy đủ: `winget install --id Gyan.FFmpeg -e`, hoặc truyền `--ffmpeg=<path>`.
  - Mức âm lượng tính theo độ to đo được (EBU R128): lời đọc −16 LUFS; nhạc −23 LUFS dưới lời đọc, nhỏ thêm 7 dB khi có lời; nhạc −18 LUFS khi đứng một mình (bản VI).
  - Tuỳ chọn: `--lang=en|vi`, `--music=<file>` (dùng nhạc khác, ví dụ một bản nhạc có license), `--no-music`.

## Sửa nội dung

- **Lời thoại và độ dài cảnh**: `tools/script.json`. Mỗi cảnh có `en`, `vi`, `planned` (giây), tuỳ chọn `tts` (câu cho TTS đọc khi khác chữ hiển thị) và `voOffset`.
- **Sau khi sửa lời thoại**: chạy `node tools/make-vo.mjs`.
  - Lệnh này đọc lại từng câu bằng Windows TTS (`audio/lines/` → `audio/vo-en.wav`) và ghi `js/timeline.js` (file sinh ra, đừng sửa tay).
  - `js/timeline.js` có thời lượng mỗi cảnh và thời điểm bắt đầu của từng từ.
  - Một cảnh dài bằng số lớn hơn giữa `planned` và lời đọc cộng khoảng nghỉ.
  - Thêm `--no-audio` nếu chỉ cần tính lại timeline (khi đó độ dài và vị trí từng từ được ước theo số chữ).
- **Hình động**: `js/scenes.js`. Mỗi cảnh là một khối mở đầu bằng comment `C<n> · <tên cảnh>`.
  - Mốc thời gian tính theo đầu cảnh (`S("C4", 0.5)`) hoặc theo một từ của lời đọc. `W("C8", "schedule")` là lúc chữ "schedule" bắt đầu; `W("C8", "And", 2)` là chữ "And" thứ hai.
  - Từ được so theo câu TTS, có phân biệt hoa thường và bỏ qua dấu câu, nên "Agent Flow" là hai từ và "Q.C." là "QC".
  - Sửa lời mà làm mất một từ đang được neo thì trang báo lỗi (`tools/shoot.mjs` in lỗi đó ra).
- **Nhạc**: `node tools/make-music.mjs` tạo `audio/music.wav` từ `js/timeline.js`. Nhạc gồm các đoạn theo cảnh, tempo chọn để chỗ đổi đoạn rơi vào đầu ô nhịp. Đổi timeline thì chạy lại lệnh này.
- **Giao diện**: `css/style.css` (chung với v2) và `css/v3.css` (phần riêng của v3: thread chat, bảng nhiều project, đồng hồ 24/7). Font Geist và Geist Mono nằm trong `assets/fonts/` (SIL OFL, có kèm giấy phép).

## Chụp ảnh tĩnh để duyệt

```bash
node tools/shoot.mjs --t=27.0,56.0          # shots/en-027.00.png, shots/en-056.00.png
node tools/shoot.mjs --lang=vi --scenes     # thêm một ảnh ở giữa mỗi cảnh
```

Lỗi JavaScript của trang (nếu có) được in ra cuối lệnh.

## Cần có

- Node 24+ (như monorepo), `@playwright/test` (lấy từ `node_modules` của monorepo) và Chromium của Playwright (`npx playwright install chromium`). Chạy các lệnh từ thư mục này.
- Windows để tạo lời đọc (System.Speech, giọng Microsoft Zira). Chỉ xem thì không cần Windows.
- ffmpeg bản đầy đủ cho `make-mp4.mjs`.

## Giới hạn của bản nháp

- Lời đọc là giọng máy, chỉ có tiếng Anh, dùng để canh nhịp. Giọng thật sẽ dài hoặc ngắn hơn. Khi có giọng thật, thay thời điểm từng từ trong timeline (mục 2 của plan v3) thì hình tự khớp.
- Nhạc nền do `make-music.mjs` tự tạo, không lấy từ bài nhạc nào. Muốn dùng nhạc có license thì truyền `--music=<file>` cho `make-mp4.mjs`.
- Mọi số liệu và tên trên màn hình là dữ liệu mẫu: ticket LD-6, repo leavedesk, công ty Acme, tên Minh, 9 project, 214 workflow, 38 case, 21 agent, số PR và số test.
- CTA/URL ở cảnh cuối chưa chốt (mục 6 của plan v3).
- `shots/`, `out/`, `audio/lines/` và `audio/music.wav` là file sinh ra, đã gitignore. Chưa có `audio/music.wav` thì nút `♪` bị tắt; chạy `node tools/make-music.mjs` (vài giây, chạy được trên mọi hệ điều hành).
