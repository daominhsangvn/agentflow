# Animatic nháp v4: video giới thiệu AgentFlow (1:23)

Dựng theo [`../explainer-video-plan-v4.md`](../explainer-video-plan-v4.md): 12 cảnh, 82.7 giây, **không có giọng đọc**. Chữ lớn trên hình thay cho lời đọc, nhạc nền chạy suốt. Bản v3.1 vẫn giữ nguyên ở [`../video-draft-v3/`](../video-draft-v3/).

## Khác v3.1

- **Bỏ giọng đọc.** Mỗi cảnh có một dòng chữ lớn (EN hoặc VI). Câu `tts` trong `tools/script.json` vẫn được đọc bằng TTS, nhưng chỉ để canh thời điểm hình động; không phát ra tiếng.
- **Giao diện thật của app, có chuyển động bên trong.** 5 cảnh U1–U5 là clip quay từ app thật (Connections, Workflows, Agents, Runs, Home) với dữ liệu mẫu, đặt trong khung trình duyệt. Trong mỗi clip, chính các phần tử của trang chuyển động: dòng mới xuất hiện, trạng thái đổi, số đếm tăng, con trỏ bấm.
- **Không xoáy vào một ticket.** LD-6 chỉ còn là ví dụ ở C3/C4/C7; phần còn lại cho thấy nhiều project, nhiều workflow, nhiều agent.

| Cảnh | Nội dung |
|---|---|
| C1 | Vấn đề: agent làm được từng phần, người vẫn phải chuyển việc |
| C2 | AgentFlow kết nối công cụ và điều phối agent, trên máy của bạn |
| U1 | App · Connections |
| U2 | App · Workflows: việc tự bắt đầu |
| C3 | Quy tắc chọn đúng agent, đúng command |
| C4 | Hỏi đúng người trên Jira hoặc chat |
| U3 | App · Agents chạy song song |
| U4 | App · Runs: mọi lần chạy, mọi kết quả, mọi PR |
| C7 | Agent không tự merge, con người merge |
| C8 | Nhiều project, cả ngày lẫn đêm |
| U5 | App · Home: thấy ngay việc nào cần bạn |
| C9 | Logo |

> Slack, Zalo, Telegram, WhatsApp, workflow bắt đầu từ email và workflow chạy theo lịch **chưa có trong code**. Theo quyết định review, các cảnh hoạt hình (C4, C8) hiện chúng như đã có; các clip giao diện thật thì không. Đọc mục 5 của plan v3 trước khi công bố.

## Xem

Mở `index.html` bằng Chrome hoặc Edge. Điều khiển như v3 (Play, tua, `♪`, `EN → VI`, nút nhảy cảnh); không còn nút `VO`. Tham số URL: `?lang=vi`, `?t=50`, `?music=0`.

## Video MP4

```bash
node tools/render-webm.mjs --lang=en      # khung hình → out/*.webm (không tiếng)
node tools/render-webm.mjs --lang=vi
node tools/make-mp4.mjs                   # out/*.webm + nhạc → out/agentflow-explainer-{en,vi}.mp4
```

Hai bản dùng chung nhạc, đưa về −16 LUFS. Tuỳ chọn của `make-mp4.mjs`: `--lang=en|vi`, `--music=<file>`, `--no-music`. Cần ffmpeg bản đầy đủ (`winget install --id Gyan.FFmpeg -e` hoặc `--ffmpeg=<path>`).

## Quay lại các clip giao diện

Clip nằm ở `assets/ui/<clip>.webm` (2560×1440, VP9). Chỉ cần quay lại khi đổi giao diện app hoặc dữ liệu mẫu.

1. Đăng nhập một lần (bạn tự đăng nhập trong cửa sổ hiện ra; phiên được lưu ở `%TEMP%\af-video\auth\state.json`, ngoài repo):
   ```bash
   node tools/app-login.mjs --url=https://<app-host>
   ```
2. Quay từng clip:
   ```bash
   node tools/ui-clip.mjs --clip=runs --url=https://<app-host> --api=https://<api-host> --org=<org-slug> [--preview=runs.mp4]
   ```
   `--clip` là `connections`, `workflows`, `agents`, `runs` hoặc `home`.
3. Xoá file phiên khi xong.

Cách hoạt động:

- `tools/app-page.mjs` mở app với phiên đã lưu và thay các response API bằng dữ liệu mẫu trong `tools/app-demo-data.mjs` (org Acme, 9 project, 22 agent, 12 workflow, 20 run).
- Công cụ chỉ đọc: mọi request không phải GET và mọi event stream đều bị chặn, nên không có gì trên server thay đổi. Đồng hồ của trang bị dừng để app không tự tải lại dữ liệu giữa chừng.
- `tools/ui-clips/<clip>.js` (dùng `kit.js`) là kịch bản chuyển động, viết thành hàm `render(t)`: cùng một thời điểm luôn ra cùng một khung hình. `ui-clip.mjs` chụp từng khung ở 30 fps rồi mã hoá.
- `tools/capture-app.mjs` chụp ảnh tĩnh các trang (để tham khảo bố cục).

## Sửa nội dung

- **Chữ trên hình và độ dài cảnh**: `tools/script.json` (`en`, `vi`, `planned`, `tts`; cảnh giao diện có thêm `clip`). Sửa xong chạy `node tools/make-vo.mjs` để tính lại `js/timeline.js`, rồi `node tools/make-music.mjs` để nhạc khớp cảnh mới.
- **Hình động**: `js/scenes.js`. Cảnh giao diện được dựng chung ở khối "app screens (U scenes)"; `UI_CAMERA` ở đó đặt chỗ zoom và lia của từng clip (`[giây trong clip, tâm x, tâm y, độ zoom]`).
- **Giao diện khung**: `css/v4.css` (khung trình duyệt, chữ lớn), dùng thêm `css/style.css` và `css/v3.css`.
- **Ảnh tĩnh để duyệt**: `node tools/shoot.mjs --t=24,52` hoặc `--scenes`.

## Giới hạn

- Mọi tên và số trên hình là dữ liệu mẫu (Acme, LD-6, LeaveDesk, Minh, Khoa, các repo `acme/*`).
- Nhạc do `make-music.mjs` tự tạo; muốn dùng nhạc có license thì truyền `--music=<file>`.
- `shots/`, `out/`, `audio/lines/`, `audio/music.wav` là file sinh ra, đã gitignore. `assets/ui/*.webm` được giữ lại vì quay lại cần phiên đăng nhập.
