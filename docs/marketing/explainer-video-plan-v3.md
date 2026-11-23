# Kế hoạch motion video giới thiệu AgentFlow · v3.1 (1:07)

> Bản v3.1, 2026-11-21, để review. Animatic: [`video-draft-v3/`](video-draft-v3/) (mở `index.html`, hoặc xem `out/*.mp4`).
> So với v3 (1:30): lời đọc đơn giản hơn, phần ví dụ LD-6 (C3–C7) ngắn lại từ 52 giây còn 33 giây, có nhạc nền.
> Plan v2 ([`explainer-video-plan.md`](explainer-video-plan.md)) và animatic v2 ([`video-draft/`](video-draft/)) giữ nguyên. Những phần v3 không nhắc lại (phong cách, cách sản xuất, tiến độ, bản cắt ngắn) vẫn theo v2.
> Đọc **mục 5** trước khi công bố: video hiện một số tính năng chưa có trong code.

## 0. Tóm tắt

| | |
|---|---|
| Độ dài | **1:07** (66.7 giây theo lời đọc tạm), 9 cảnh. Phần ví dụ LD-6 chiếm 33 giây |
| Thông điệp | Như v2. AgentFlow không tự làm việc: nó kết nối công cụ của team và điều phối các agent. Agent là máy của bạn chạy Claude Code. Con người quyết định |
| Ba agent | **BA · Requirements**, **Engineering · Code**, **QC · Testing**, trong một flow dùng cả ba (ticket LD-6 của dự án mẫu LeaveDesk). Flow này chỉ là ví dụ nhanh, không phải trọng tâm |
| Mới so với v2 | (1) Hỏi người ngay nơi họ trao đổi: comment trên Jira và thread trên Teams, Slack, Zalo, Telegram, WhatsApp. Trên chat, người được hỏi bị @mention; họ trả lời, xác nhận, AgentFlow ghi nhận rồi chuyển bước tiếp. (2) Nhiều project cùng lúc, mỗi project hàng chục workflow, chạy song song. (3) Chạy cả ngày lẫn đêm; workflow bắt đầu từ một ticket, một email hoặc theo lịch |
| Lời đọc | Câu ngắn, từ thường ngày. Không liệt kê tên ứng dụng chat hay chi tiết kỹ thuật bằng lời: hình đã cho thấy |
| Nhạc | Nhạc nền tự tạo (không có bản quyền của ai khác), đổi theo cảnh; nhỏ xuống khi có lời đọc (mục 2) |
| Câu kết | **Agents do the work. AgentFlow coordinates. People decide.** · *Agent làm việc. AgentFlow điều phối. Con người quyết định.* |
| Ngôn ngữ | Master tiếng Anh + bản tiếng Việt (chữ trên hình và phụ đề đã có cả hai) |

## 1. Thay đổi so với v2

v2 dài khoảng 2:23 với 18 cảnh. v3 gộp lại còn 9 cảnh và dùng thời gian tiết kiệm được cho ba nội dung mới. v3.1 rút ngắn tiếp phần ví dụ LD-6.

| v3.1 | Gộp từ v2 | Khác v2 |
|---|---|---|
| C1 People in the middle | C1 Agent giỏi, C2 Người ở giữa, C3 Mất dấu | Ô Chat hiện Teams, Slack, Zalo, Telegram, WhatsApp |
| C2 AgentFlow in the middle | C4 AgentFlow vào ô giữa, C5 Ba agent ba máy, C6 Kết nối | |
| C3 A ticket comes in | C7 Thẻ kỹ năng, C8 Quy tắc → thanh flow, C9 Ticket đến, C10 Giao việc cho BA | Ba bảng (quy tắc, thẻ kỹ năng, lịch sử) hiện nhanh cùng lúc |
| C4 Ask people where they talk | C11 BA viết yêu cầu, con người duyệt | **Mới**: hỏi trên Jira và năm ứng dụng chat, thread có @mention, trả lời, xác nhận, ghi nhận |
| C5 Plan and build | C12 Engineering và QC cùng bắt đầu, C14 Engineering viết code | Bỏ cảnh guard chặn command (v3.1) |
| C6 Test and fix | C15 QC kiểm thử, việc sửa quay về Engineering | Bỏ bảng lịch sử và comment "fix D-1" (v3.1) |
| C7 People merge | C16 Done | |
| C8 Many projects, day and night | C17 Thấy hết | **Mới**: 9 project, hàng chục workflow mỗi project, chạy song song; đồng hồ 24/7; bắt đầu từ ticket, email, lịch; bảng "Needs attention" |
| C9 Logo + line | C18 Kết | |

Bỏ so với v2:
- cảnh riêng cho từng bảng (quy tắc, thẻ kỹ năng);
- guard chặn command (v3.1);
- chi phí trên màn hình "thấy hết" (chi phí không phải lúc nào cũng có, xem v2 mục 11).

## 2. Cấu trúc và thời lượng

| Cảnh | Thời gian | Lời đọc (giây) |
|---|---|---|
| C1 People in the middle | 0:00–0:07 | 6.4 |
| C2 AgentFlow in the middle | 0:07–0:15 | 7.5 |
| C3 A ticket comes in | 0:15–0:21 | 5.4 |
| C4 Ask people where they talk | 0:21–0:32 | 10.1 |
| C5 Plan and build | 0:32–0:38 | 4.8 |
| C6 Test and fix | 0:38–0:44 | 5.3 |
| C7 People merge | 0:44–0:48 | 2.7 |
| C8 Many projects, day and night | 0:48–1:00 | 9.8 |
| C9 Logo + line | 1:00–1:06 | 5.3 |

Thời lượng đo bằng giọng TTS tạm (Microsoft Zira). Mỗi chuyển động neo vào một từ của lời đọc. `make-vo.mjs` lấy thời điểm từng từ từ engine TTS và ghi vào `timeline.js`. Khi đổi lời hay đổi giọng, hình tự khớp theo; nếu lời mới bỏ mất một từ đang được neo, trang báo lỗi ngay.

### Nhạc nền

Nhạc nền do `video-draft-v3/tools/make-music.mjs` tạo từ timeline. Nhạc không lấy từ bài nào có sẵn, nên không vướng bản quyền.

- 109.2 BPM, Đô trưởng / La thứ, mỗi ô nhịp một hợp âm. Tempo được chọn để mỗi lần đổi đoạn rơi đúng nhịp, lệch tối đa 28 ms so với chỗ chuyển cảnh.
- Các đoạn:
  - C1: chỉ có pad và bass giữ nốt, hai hợp âm Am7–F, chưa giải quyết.
  - C2: vào hợp âm C; bass đập theo móc đơn và có thêm tiếng pluck rải hợp âm.
  - C3–C7: hi-hat từ C3, kick nhẹ từ C4, hi-hat dày hơn từ C5, một tiếng riser ngay trước C8.
  - C8: đầy nhất (kick bốn phách, clap, hi-hat mở).
  - C9: hợp âm Cadd9 rồi tắt dần, về im lặng đúng lúc hết video.
- Mức âm lượng (`make-mp4.mjs`): bản EN có nhạc ở −23 LUFS, nhỏ thêm 7 dB khi có lời đọc (dốc 0.35 giây); bản VI chỉ có nhạc, ở −18 LUFS.
- Đây là nhạc tạm để duyệt nhịp. Bản công bố có thể dùng nhạc có license bằng cách truyền `--music=<file>` cho `make-mp4.mjs`.

## 3. Kịch bản lời đọc

| Cảnh | EN | VI |
|---|---|---|
| C1 | AI agents can write requirements, code and tests. But people still carry the work between them. | AI agent viết được yêu cầu, code và test. Nhưng con người vẫn phải chuyển việc qua lại giữa chúng. |
| C2 | AgentFlow takes over that job. It connects your tools and coordinates your agents, on your own machines. | AgentFlow nhận việc đó. Nó kết nối công cụ và điều phối các agent, ngay trên máy của bạn. |
| C3 | A ticket comes in. AgentFlow checks your rules and calls the right agent. | Một ticket đến. AgentFlow xem quy tắc của bạn và gọi đúng agent. |
| C4 | The agent has questions. AgentFlow asks the right person, in Jira or your team chat. They answer and confirm, and AgentFlow records it. | Agent có câu hỏi. AgentFlow hỏi đúng người, trên Jira hoặc chat của team. Họ trả lời, xác nhận, và AgentFlow ghi nhận. |
| C5 | Engineering and QC plan in parallel. Then Engineering writes the code. | Engineering và QC lập kế hoạch song song. Rồi Engineering viết code. |
| C6 | QC tests it. If a test fails, the fix goes back to Engineering. | QC kiểm thử. Test nào lỗi thì việc sửa quay về Engineering. |
| C7 | Agents never merge. People do. | Agent không tự merge. Con người merge. |
| C8 | AgentFlow runs many projects at once, day and night. Work starts from a ticket, an email or a schedule. And you see what needs a person. | AgentFlow chạy nhiều project cùng lúc, cả ngày lẫn đêm. Việc bắt đầu từ một ticket, một email hay theo lịch. Và bạn thấy ngay việc nào cần người. |
| C9 | Agents do the work. AgentFlow coordinates. People decide. | Agent làm việc. AgentFlow điều phối. Con người quyết định. |

Nguồn của kịch bản là `video-draft-v3/tools/script.json`. Nếu sửa ở đây thì sửa cả ở đó, rồi chạy `node tools/make-vo.mjs`.

## 4. Storyboard

Từ trong ngoặc kép ở đầu mỗi ý là từ của lời đọc mà chuyển động đó neo vào.

### C1 · 0:00–0:07 · People in the middle

Ba cửa sổ kết quả của agent (Requirements, Code, Tests) tự gõ nội dung. Ngay trước "But", chúng thu lại thành ba agent, bốn công cụ hiện bên trái (Jira · Azure DevOps, Chat với Teams, Slack, Zalo, Telegram, WhatsApp, Confluence, Git), và một người đứng ở giữa bắt đầu chép-dán qua lại. "Who approved what?" hiện ra khi đọc "carry", "What's still waiting?" khi đọc "between". Màu của khung hình nhạt dần.

### C2 · 0:07–0:15 · AgentFlow in the middle

AgentFlow thay vào chỗ người ở giữa, màu quay lại. Người đi lên hàng trên (Admin, BA, Engineer, QC · "decide"). "connects": đường tới bốn công cụ, cùng biểu tượng khoá (kết nối và khoá tới các công cụ do AgentFlow giữ). "coordinates": đường tới ba agent, mỗi agent là một máy: BA · Requirements (server), Engineering · Code (laptop của developer), QC · Testing (test server). "own machines": khung "Your infrastructure" bao quanh ba máy.

### C3 · 0:15–0:21 · A ticket comes in

Ticket LD-6 ("As a manager, I want a calendar of who in my team is off") đến từ Jira, thanh flow sáng ô Requirements. "checks your rules": ba bảng bật lên cách nhau 0.3 giây: Rules (các bước, vai trò ở từng bước, "Questions → #ba · ask Minh (BA)"), Skill cards (command của từng agent) và History · LD-6. "calls": phiếu `/ba-requirement` qua cổng kiểm tra rồi tới agent BA, nhanh hơn ở v3.

### C4 · 0:21–0:32 · Ask people where they talk

- "questions": agent BA hiện "3 questions", bong bóng bay về AgentFlow. "Agent Flow asks": quy tắc "Rules: questions → #ba · ask Minh (BA)" hiện dưới AgentFlow. "right": avatar BA mang dấu @.
- "Jira": comment của AgentFlow trên LD-6 hiện ra: "3 questions about the requirements. Reply in this thread." Comment này không @mention ai, vì AgentFlow chỉ @mention người được hỏi trên Teams (mục 5).
- "team chat": thread #ba mở ra và đổi màu, nhãn qua từng ứng dụng, mỗi ứng dụng nửa giây: Teams → Slack → Zalo → Telegram → WhatsApp → Teams. Thông báo "AgentFlow mentioned you" hiện ở góc trên.
- Diễn biến trong thread:
  - AgentFlow đăng 3 câu hỏi và @Minh.
  - "They": Minh trả lời.
  - "confirm": AgentFlow tóm tắt và hỏi Minh xác nhận; Minh trả lời "Confirmed ✓".
  - "records": thread hiện "✓ Recorded on LD-6 · confirmed by Minh", câu trả lời bay về AgentFlow.
- Mọi tin trả lời đều @mention AgentFlow, đúng cách Teams hoạt động (mục 5).
- Thread thu lại vào ô Chat, ô này đổi thành "#ba · confirmed ✓".

### C5 · 0:32–0:38 · Plan and build

Bản yêu cầu của BA bay vào Confluence. "Engineering and QC": hai phiếu `/writing-plans` và `/qa-test` cùng đi ("In parallel"). Trước "Then", Confluence nhận "Implementation plan · Test plan". "Then": phiếu `/executing-plans` tới Engineering; code hiện trên nhánh tính năng (TeamCalendar.tsx, useTeamLeave.ts…), rồi pull request đi tới Git.

### C6 · 0:38–0:44 · Test and fix

QC chạy test. "fails": 32/33, một ô đỏ (D-1), thanh flow quay về Implement. "the fix": "resume · same session", Engineering sửa ("+ fix D-1"). Chạy lại, được 33/33 ✓.

### C7 · 0:44–0:48 · People merge

"Agents never merge." Có hai pull request: Code · Engineering và Tests · QC. "People do": một người bấm Merge ở cả hai, mỗi PR chuyển từ "In review" sang "Merged". Ô Git đổi thành "2 PRs merged ✓", ticket LD-6 sang Done.

### C8 · 0:48–1:00 · Many projects, day and night

- Camera lùi ra. Bản đồ LeaveDesk thu nhỏ thành một ô trong lưới 9 project: Payments, Mobile app, Data platform, Website, HR portal, Support bot, Billing và Internal tools. Mỗi ô có:
  - thanh flow;
  - bốn làn workflow có case đang chạy;
  - dòng "+N more workflows";
  - đèn báo agent.
- Số liệu hiện theo lời đọc:
  - "9 projects";
  - "many": "214 workflows", cùng số workflow trên từng ô;
  - "once": "38 cases running" và "21 agents online"; mọi ô sáng viền.
- "day and night": đồng hồ 24/7 tua nhanh từ thứ Hai 09:00 qua đêm (mặt đồng hồ chuyển màu đêm). Nó tới thứ Ba 02:00 đúng lúc lịch Nightly audit chạy, rồi chạy tiếp.
- Mỗi làn có icon cho cách nó bắt đầu: ticket, email hoặc lịch. "a ticket", "an email", "a schedule": các làn cùng loại sáng lên và lan khắp lưới. Mỗi loại có một ví dụ hiện ra:
  - "New ticket · PAY-41 → starts Delivery";
  - "New email · support@acme.com → starts Ticket triage";
  - "Schedule · every day 02:00 → starts Nightly audit".
- "And you see what needs a person": lưới dịch sang trái và bảng "Needs attention" hiện ra với bốn việc. Ô tương ứng trên lưới viền vàng.
  - LD-12 · Waiting for a person · asked on Teams
  - PAY-7 · Pending decision
  - DATA-5 · Waiting for a person · asked on Zalo
  - MOB-33 · Blocked task

### C9 · 1:00–1:06 · Logo + line

Ba đường màu agent vẽ vào thành logo, kèm ba dòng "Agents do the work. / AgentFlow coordinates. / People decide." Bên dưới là "Self-hosted · Open source (MIT)" và chỗ dành cho CTA/URL (chưa chốt). Nhạc về hợp âm cuối và tắt dần đúng lúc hết video.

## 5. Kiểm chứng nội dung

Nguyên tắc như v2 mục 11: mỗi câu khẳng định phải có nguồn trong docs hoặc code. Các claim của C1–C3 và C5–C7 không đổi so với v2, nên dùng lại bảng ở v2 mục 11. Đường dẫn docs dưới đây tính từ `apps/web/content/docs/`.

### Đã có trong code

| Trên video | Nguồn | Giới hạn |
|---|---|---|
| Hỏi qua comment Jira, ghi nhận câu trả lời (C4): các câu hỏi nằm trong một comment đánh số trên ticket, mọi người trả lời trong thread của comment | `guides/recipes/questions-and-answers.mdx` | Comment Jira không @mention người. Chỉ hỏi trên Teams mới @mention (`apps/api/lib/integrations/providers/microsoft-teams/channel-ask.ts`); phía Jira chỉ nhận biết @mention gửi tới bot (`apps/api/lib/integrations/providers/jira/mentions.ts`). Như v2: không nói "chỉ người có quyền mới duyệt được" |
| Hỏi trên Teams (C4): mỗi case một thread mỗi kênh, @mention người được hỏi; tin trả lời phải @mention bot; AgentFlow thảo luận rồi tóm tắt; chỉ ghi nhận khi một người được hỏi xác nhận bản tóm tắt | `integrations/microsoft-teams.mdx`, mục "Asking people" | Chỉ cho workflow orchestrated. Ai trong kênh cũng viết được; xác nhận của người không được hỏi bị từ chối |
| Chạy 24/7 (C8) | `reference/server-env.mdx`: server self-hosted có bộ lập lịch chạy trong process, tick workflow mỗi `WORKFLOW_TICK_SECONDS` (mặc định 10 giây) | Việc chỉ chạy khi có Agent online. Không nói "không cần máy nào bật" |
| Nhiều project, hàng chục workflow, chạy song song (C8) | Docs không nêu giới hạn số project hay workflow; `guides/setup/agents.mdx` | Mỗi Agent chạy một số command cùng lúc (mặc định 2, tối đa 16), và loop còn bị giới hạn theo người chạy (`runAs`, `guides/setup/workflow-yaml.mdx`). Số trên lưới (9 / 214 / 38 / 21) là dữ liệu mẫu, có nhãn "demo data" |
| Bắt đầu từ một ticket (C8) | `guides/setup/triggers-and-actions.mdx` (Jira, Azure DevOps) | |
| Bảng "Needs attention" (C8) | `guides/operate/home.mdx` | Nhãn trên bảng là bản rút gọn |

### Chưa có trong code (2026-11-21), video hiện như đã có theo quyết định review

| Trên video | Hiện trạng | Phải có trước khi công bố |
|---|---|---|
| Slack, Zalo, Telegram, WhatsApp: ô Chat ở C1–C7, thread và thông báo ở C4, "asked on Zalo" ở C8 | Không có trong `integrations/` và không có trong code. Ứng dụng chat duy nhất là Microsoft Teams | Kết nối cho từng ứng dụng, có cùng luồng hỏi của Teams: @mention, thread, tóm tắt, xác nhận |
| Workflow bắt đầu từ một email: lời đọc C8, icon email trên các làn, ví dụ "New email · support@acme.com" | Email chỉ có chiều gửi đi qua SMTP (lời mời, reset mật khẩu, action `agentflow.email`), theo `integrations/email.mdx`. Không có trigger khi nhận mail | Trigger khi nhận email |
| Workflow chạy theo lịch: lời đọc C8, icon đồng hồ trên các làn, "Schedule · every day 02:00 → Nightly audit" | Các trigger hiện có là Jira, Azure DevOps, Teams (`microsoft_teams.bot_mentioned`) và webhook/HTTP. Bộ lập lịch của server chỉ chạy việc nội bộ. Có **Routines** (agent chạy theo lịch, PRD-566, `apps/app/app/(authenticated)/[orgSlug]/routines/page.tsx`) nhưng chưa GA: ẩn sau feature flag `routines` (mặc định tắt) và chạy trên app desktop; bản deploy af.qnois.xyz chưa bật (2026-11-22). Routines chưa phải trigger của workflow | Routines ra GA, hoặc trigger theo lịch cho workflow, ví dụ audit hằng đêm hay việc hằng ngày |

Nếu cần công bố trước khi các tính năng trên ra mắt, đổi sang những thứ đã có:

| Thay | Bằng |
|---|---|
| C4: thread lướt qua Teams, Slack, Zalo, Telegram, WhatsApp | Lời đọc giữ nguyên ("your team chat"); thread chỉ ở giao diện Teams; ô Chat chỉ còn Teams |
| C8: "Work starts from a ticket, an email or a schedule" | "Work starts from a ticket, a Teams message or a webhook". Ví dụ: "Teams · @AgentFlow in #support → starts Ticket triage", "Webhook · build failed → starts Pipeline fix". Đồng hồ 24/7 giữ nguyên nhưng bỏ mốc 02:00 |
| C8: "asked on Zalo" | "asked on Jira" |

### Không được nói (bổ sung cho danh sách ở v2 mục 11)

- Không nói AgentFlow vẫn chạy khi không có Agent nào online. Server luôn chạy, còn việc cần Agent.
- Không nói "không giới hạn" hay chạy song song vô hạn.
- Không đưa con số thật lên lưới C8 khi chưa có dữ liệu; giữ nhãn "demo data" hoặc dùng tên rõ ràng là giả.

## 6. Quyết định cần chốt

| # | Câu hỏi | Đề xuất |
|---|---|---|
| 1 | Slack, Zalo, Telegram, WhatsApp, trigger email và trigger theo lịch chưa có trong code | Chỉ công bố video khi các tính năng này đã ra mắt. Nếu cần công bố sớm, dùng phương án thay thế ở mục 5 |
| 2 | CTA và URL ở C9 | Như v2 mục 15 #11: cần chốt domain và link GitHub |
| 3 | Giọng đọc thật (EN, VI) | Thu xong thì lấy thời điểm từng từ (forced alignment, hoặc đánh dấu tay) thay cho dữ liệu của TTS; hình tự khớp theo (mục 2) |
| 4 | Số liệu mẫu trên lưới C8 | Giữ nhãn "demo data" trong mọi bản công bố |
| 5 | Các quyết định còn mở của v2 (mục 15: tên command thật trên thẻ, nói rõ bộ điều phối là AI, ẩn dụ logo, cách sản xuất) | Giữ nguyên đề xuất của v2 |
