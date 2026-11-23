# Animatic nháp: video giới thiệu AgentFlow

Animatic chạy trong trình duyệt, dựng theo kịch bản v2 ở [`../explainer-video-plan.md`](../explainer-video-plan.md): 18 cảnh, khoảng 2:23. Bản này để duyệt nhịp, bố cục và lời thoại trước khi làm motion thật, chưa phải video hoàn chỉnh.

## Xem

Mở `index.html` bằng Chrome hoặc Edge (double-click là được, không cần server).

| Điều khiển | Tác dụng |
|---|---|
| ▶ Play, thanh tua | Phát, dừng, tua |
| `VO` | Bật/tắt lời đọc tạm (chỉ có tiếng Anh) |
| `CC` | Bật/tắt phụ đề |
| `EN → VI` | Đổi ngôn ngữ chữ trên hình và phụ đề |
| `C1` … `C18` | Nhảy tới đầu cảnh |
| Space · ← / → · Home | Phát/dừng · lùi/tiến 3 giây · về đầu |

Tham số URL: `?lang=vi` (tiếng Việt), `?t=71.5` (mở ở giây 71.5), `?vo=0` (tắt lời đọc).
Ở bản tiếng Việt lời đọc tắt sẵn, vì giọng tạm chỉ có tiếng Anh (máy chưa có giọng TTS tiếng Việt); bấm `VO` nếu vẫn muốn nghe. Phụ đề là kịch bản VI.

## Video xem nhanh (không có tiếng)

`out/agentflow-explainer-en.webm` và `out/agentflow-explainer-vi.webm`: 1920×1080, 30 fps, phụ đề in trên hình, không có tiếng. Tiện để gửi người khác xem.

```bash
node tools/render-webm.mjs --lang=en      # khoảng 4 phút mỗi bản
node tools/render-webm.mjs --lang=vi --from=61.6 --to=84.7 --out=out/c9-c11.webm
```

Script render từng khung hình (khung nào cũng chính xác, không phụ thuộc tốc độ máy) bằng ffmpeg đi kèm Playwright. Bản ffmpeg này không có codec âm thanh. Muốn ghép lời đọc thì cần ffmpeg bản đầy đủ:

```bash
ffmpeg -i out/agentflow-explainer-en.webm -i audio/vo-en.wav -c:v libx264 -pix_fmt yuv420p -crf 18 -c:a aac -b:a 192k out/agentflow-explainer-en.mp4
```

## Sửa nội dung

- **Lời thoại và độ dài cảnh**: `tools/script.json`. Mỗi cảnh có `en`, `vi`, `planned` (giây), tuỳ chọn `tts` (câu cho TTS đọc khi khác chữ hiển thị) và `voOffset`.
- **Sau khi sửa lời thoại**: chạy `node tools/make-vo.mjs`. Lệnh này đọc lại từng câu bằng Windows TTS (`audio/lines/` → `audio/vo-en.wav`) rồi tính lại thời lượng mỗi cảnh vào `js/timeline.js` (file sinh ra, đừng sửa tay). Thêm `--no-audio` nếu chỉ cần tính lại timeline (độ dài lời đọc khi đó ước theo số từ).
- **Hình động**: `js/scenes.js`, mỗi cảnh là một khối mở đầu bằng comment `C<n> · <tên cảnh>`. Mốc thời gian tính theo đầu cảnh (`S("C10", 0.5)`) hoặc theo lời đọc (`V("C10", 0.64)`), nên khi lời thoại dài ra hay ngắn đi thì hình giãn theo. `js/engine.js`: mỗi khung hình là hàm thuần của thời gian `t`, tua tới đâu cũng ra đúng hình đó.
- **Giao diện**: `css/style.css`. Font Geist và Geist Mono nằm trong `assets/fonts/` (SIL OFL, có kèm giấy phép).

## Chụp ảnh tĩnh để duyệt

```bash
node tools/shoot.mjs --t=12,40.5            # shots/en-012.00.png, shots/en-040.50.png
node tools/shoot.mjs --lang=vi --scenes     # thêm một ảnh ở giữa mỗi cảnh
```

Lỗi JavaScript của trang (nếu có) được in ra cuối lệnh.

## Cần có

- Node 24+ (như monorepo) và `@playwright/test` (lấy từ `node_modules` của monorepo), Chromium của Playwright (`npx playwright install chromium`). Chạy các lệnh từ thư mục này.
- Windows để tạo lời đọc (System.Speech, giọng Microsoft Zira). Chỉ xem thì không cần Windows.

## Giới hạn của bản nháp

- Lời đọc là giọng máy, chỉ có tiếng Anh, dùng để canh nhịp. Bản final dùng giọng thật hoặc TTS có license thương mại (mục 10 của plan).
- Ticket LD-6, repo leavedesk, công ty Acme, số PR, số test và chi phí trên màn hình đều là dữ liệu mẫu.
- CTA/URL ở cảnh cuối chưa chốt (mục 15 của plan).
- `shots/`, `out/` và `audio/lines/` là file sinh ra, đã gitignore.
