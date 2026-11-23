# Kế hoạch motion video giới thiệu AgentFlow

> Bản đề xuất v2, 2026-11-21, để review. Duyệt **flow mẫu (mục 3)** và **kịch bản (mục 6)** trước; các mục sau phụ thuộc vào hai mục này. Các điểm cần chốt ở mục 15.
>
> Thay đổi so với v1:
> - Agent mang tên vai trò kèm việc làm: **BA · Requirements**, **Engineering · Code**, **QC · Testing**.
> - Thêm flow mẫu dùng cả ba agent (mục 3) và "thanh flow" trên màn hình (mục 4.5).
> - Bỏ bước BA lưu trữ khỏi flow.
> - Độ dài ~2:18.

## 0. Tóm tắt

| | |
|---|---|
| Dạng | Explainer 2D motion graphics. Master ~2:18, thêm bản 60s / 30s / 15s và một loop ngắn |
| Khán giả | Mọi người: lãnh đạo, PM/BA/QC, dev, đối tác, khán giả sự kiện. Không cần biết kỹ thuật |
| Câu kết | **Agents do the work. AgentFlow coordinates. People decide.** · *Agent làm việc. AgentFlow điều phối. Con người quyết định.* |
| Ba agent | **BA · Requirements** (yêu cầu), **Engineering · Code** (viết code), **QC · Testing** (kiểm thử). Mỗi agent là một máy tính của bạn chạy Claude Code |
| Flow | Một ticket đi qua cả ba agent: BA viết yêu cầu → Engineering và QC cùng lập kế hoạch → Engineering viết code → QC kiểm thử → lỗi thì quay về Engineering → QC chạy lại → con người merge |
| Phải thấy rõ | (1) AgentFlow không tự làm việc: nó điều phối các agent và kết nối chúng với công cụ của team. (2) Agent là máy tính của bạn chạy Claude Code. (3) Vì sao AgentFlow biết giao command nào cho agent nào: quy tắc + thẻ kỹ năng + lịch sử ticket, và guard chặn những gì nằm ngoài |
| Câu chuyện | Ticket LD-6 của dự án mẫu LeaveDesk, đã chạy thật và được ghi lại trong case study: "Là quản lý, tôi muốn xem lịch ai trong team đang nghỉ". Video dùng bản rút gọn (mục 3) |
| Hình ảnh then chốt | **Người ở giữa → người ở trên**: AgentFlow thay phần chép-dán, con người giữ phần quyết định. Kèm theo là **thanh flow** cho biết ticket đang ở bước nào và agent nào đang làm |
| Ngôn ngữ | Master tiếng Anh (website có en/de/es/fr/pt/zh, chưa có vi) + bản lồng tiếng Việt |
| Sản xuất | Remotion (React) trong monorepo + motion designer làm styleframe và animatic |
| Tiến độ | ~5 tuần, 4 cổng duyệt |

## 1. Mục tiêu

Xem một lần xong, một người không làm kỹ thuật trả lời được 4 câu:

| # | Câu hỏi | Câu trả lời mong muốn |
|---|---|---|
| 1 | Ai làm việc thật? | Ba agent: BA lo yêu cầu, Engineering viết code, QC kiểm thử. Mỗi agent là một máy tính của mình (máy chủ, laptop của dev) chạy Claude Code |
| 2 | AgentFlow làm gì? | Điều phối các agent và kết nối chúng với Jira, Confluence, Git |
| 3 | Sao nó biết giao việc gì cho agent nào? | Đọc quy tắc của team, thẻ kỹ năng mỗi agent khai báo và lịch sử ticket. Cái gì không khai báo hoặc thiếu đầu vào thì bị chặn |
| 4 | Con người ở đâu? | Viết quy tắc, trả lời câu hỏi, duyệt, merge |

4 câu này cũng là bài test hiểu ở animatic và bản cuối (mục 14).

Nơi dùng: landing page, YouTube, LinkedIn, deck bán hàng, sự kiện/workshop. Bản loop ngắn dùng cho README.

## 2. Thông điệp

### Bài toán

AI agent đã làm được việc thật. Nhưng trong hầu hết các team, **con người đang làm chất keo**: giao việc cho từng agent, chép ngữ cảnh từ agent này sang agent kia, dán kết quả về Jira, Confluence, Git. Team thành người đưa thư, và không ai thấy rõ ai làm gì, ai duyệt gì, tốn bao nhiêu.

### Lời giải

AgentFlow nhận phần chất keo đó:

- **Điều phối:** quyết định bước tiếp theo, giao cho agent nào, chạy command nào, với đầu vào nào.
- **Tích hợp:** nhận sự kiện từ công cụ, giữ kết nối, ghi kết quả về.

Việc thật do agent làm trên máy của bạn. Quyết định vẫn là của con người.

### Ba vai, ba động từ

| Vai | Là gì | Động từ |
|---|---|---|
| Agent | Máy tính của bạn chạy Claude Code với bộ command của team. Trong video có ba agent: **BA · Requirements** (rack máy chủ), **Engineering · Code** (laptop của một developer), **QC · Testing** (máy chủ test) | làm việc |
| AgentFlow | Bộ điều phối + lớp tích hợp, chạy trên máy chủ của bạn | điều phối, kết nối |
| Con người | Team của bạn (Admin, BA, Engineer, QC) | viết quy tắc, trả lời, duyệt, merge |

### Vì sao AgentFlow chọn đúng: phần cốt lõi cần hình hoá

Mỗi khi có sự kiện (ticket đổi trạng thái, có comment mới), bộ điều phối đọc ba nguồn rồi mới giao việc:

| Nguồn | Ai viết | Trả lời câu hỏi nào | Ví dụ trong flow mẫu |
|---|---|---|---|
| **Quy tắc** | Admin, bằng lời thường. Chỉ nêu vai trò, không nêu tên command | Bước này làm gì, vai trò nào làm | "Planning: cùng lúc Engineering lập kế hoạch code, QC lập kế hoạch test" |
| **Thẻ kỹ năng** (`AGENTFLOW.md`) | Mỗi agent tự khai báo | Agent nào có vai trò đó; command nào của nó tạo ra thứ đang cần; command đó cần đầu vào gì | Engineering: `/writing-plans` cần *requirements*, tạo ra *plan* |
| **Lịch sử ticket** (case) | AgentFlow ghi lại | Đã có gì, ai đã làm gì, người đã trả lời hay duyệt gì | BA đã tạo bản yêu cầu v4 và người đã duyệt, nên Engineering và QC cùng bắt đầu được. Code do Engineering viết nên việc sửa quay về Engineering |

Sau khi chọn, **guard** của AgentFlow kiểm tra mọi lệnh giao việc, bất kể AI quyết định gì: command phải được khai báo, command chỉ-đọc không được ghi, đầu vào phải có. Lệnh bị chặn được ghi vào lịch sử ticket với nhãn "Refused".

Kịch bản cho mỗi nguồn một khoảnh khắc làm nhân vật chính: **quy tắc** khi giao việc cho BA (C10), **thẻ kỹ năng** khi Engineering và QC cùng bắt đầu (C12), **guard** ở C13, **lịch sử** khi việc sửa quay về Engineering (C15).

### Từ ngữ

**Không dùng chữ "runner"**, cả trong lời đọc lẫn trên hình. Thẻ `AGENTFLOW.md` trên màn hình không hiện khoá `runner:` (thực chất khoá này là vai trò); chỉ hiện tên agent.

| Trong sản phẩm | Nói trong video (EN / VI) |
|---|---|
| Tên agent | **BA · Requirements**, **Engineering · Code**, **QC · Testing** / **BA · Yêu cầu**, **Engineering · Viết code**, **QC · Kiểm thử**. Lần đầu nhắc trong lời đọc luôn kèm việc ("BA for requirements"). Không gọi agent là "Dev" |
| Agent (automatic, personal) | agent: "a computer you own, running Claude Code" / "máy tính của bạn chạy Claude Code" |
| AgentFlow + Orchestrator Agent | AgentFlow. Khi cần tách riêng: "the coordinator" / "bộ điều phối" |
| `AGENTFLOW.md` | skill card / thẻ kỹ năng (tên file ghi nhỏ ở góc thẻ) |
| Rules (`agent.instructions`) | rules / quy tắc |
| Case | the ticket's history / lịch sử ticket |
| `needs` / `produces` | needs / makes · cần / tạo ra |
| Guard | refused / bị chặn |
| Resume task (cùng phiên) | "sends it back to the agent that wrote the code" / "gửi về đúng agent đã viết code" |
| PRD | requirements / bản yêu cầu (trên hình có thể ghi nhỏ "PRD") |
| Không nhắc tới | turn, debounce, MCP, YAML, loop, session, toolkit, task_run, compute target |

### Góc định vị

Video mở bằng góc "điều phối, con người quyết định", khớp với README, docs và deck LD-6. Hero landing hiện tại lại mở bằng "Stop burning tokens" (ISS-5490); trong video, chi phí chỉ là một bằng chứng phụ (C3, C17). Nếu đặt video ngay dưới hero đó, trang sẽ nói hai thông điệp, đúng vấn đề mà comment ISS-5490 trong `apps/web/.../team-section.tsx` đã nêu ("read as two products on one page"). Xem mục 15.

## 3. Flow mẫu: một ticket, ba agent

Đây là flow video kể. Nó là bản rút gọn của LD-6 (khác biệt ở cuối mục). Quy tắc của team đi theo trạng thái ticket trên Jira:

```
Trạng thái  │ Requirements    │ Planning         │ Implement          │ Testing          │ Review │ Done
────────────┼─────────────────┼──────────────────┼────────────────────┼──────────────────┼────────┼─────
BA          │ /ba-requirement │                  │                    │                  │        │
Engineering │                 │ /writing-plans   │ /executing-plans ◀─┼─ "fix D-1"       │        │
QC          │                 │ /qa-test         │                    │ /qa-run (2 lần)  │        │
Con người   │ trả lời, duyệt  │ duyệt            │                    │ viết "fix D-1"   │ merge  │  ✓
```

| Bước | Agent làm | Command | Cần → tạo ra | AgentFlow (điều phối + tích hợp) | Con người |
|---|---|---|---|---|---|
| Requirements | BA | `/ba-requirement` | ticket → bản yêu cầu; có thể đặt câu hỏi | Chọn BA theo quy tắc; đưa nội dung ticket vào phiếu giao việc (agent không đọc Jira); đăng trang yêu cầu lên Confluence; chuyển 8 câu hỏi tới người | Trả lời, sửa trang (v1 → v4), chuyển ticket sang Planning (= duyệt) |
| Planning | Engineering và QC, song song | `/writing-plans`, `/qa-test` | bản yêu cầu → kế hoạch; bản yêu cầu → kế hoạch test | Thấy bản yêu cầu đã có nên giao cả hai cùng lúc, kèm trang yêu cầu hiện tại; đăng hai trang lên Confluence | Xem, chuyển sang Implement (= duyệt) |
| Implement | Engineering | `/executing-plans` | kế hoạch đã duyệt → code + pull request (laptop tự mở PR bằng tài khoản Git của developer) | Giao kèm trang kế hoạch hiện tại | — |
| Testing | QC | `/qa-run` | kế hoạch test → kết quả test: 32/33, lỗi D-1 | Đăng trang "Test run 1"; mở pull request phần test | Chuyển về Implement, viết "fix D-1" |
| Implement (sửa) | Engineering, đúng agent cũ | `/executing-plans`, tiếp tục phiên cũ | ghi chú sửa → code đã sửa | Lịch sử cho biết Engineering viết code → gửi việc sửa về đó | Chuyển lại sang Testing |
| Testing (lần 2) | QC | `/qa-run` (chạy lại) | → 33/33 | Đăng trang "Test run 2" | Chuyển sang Review |
| Review → Done | — | — | — | Liệt kê các pull request | Review, merge, đóng ticket |

**Chuỗi bàn giao.** Đây là điều video phải làm cho người xem thấy: đầu ra của agent này là đầu vào của agent kia, và đó là lý do AgentFlow biết gọi ai.

1. BA tạo **bản yêu cầu** → đầu vào của cả Engineering (`/writing-plans`) lẫn QC (`/qa-test`).
2. Engineering tạo **kế hoạch** → con người duyệt → đầu vào của Engineering (`/executing-plans`).
3. QC tạo **kế hoạch test** → đầu vào của QC (`/qa-run`), chạy trên nhánh code của Engineering.
4. QC báo lỗi → con người viết "fix D-1" → lịch sử cho biết Engineering viết code → việc sửa quay về Engineering.

**Khác với LD-6:**

- Vai trò "Dev" đổi tên thành "Engineering". Tên vai trò là chữ do team tự đặt trong `AGENTFLOW.md`, nên cơ chế không đổi.
- Bỏ `/ba-archive`, bước BA lưu bản yêu cầu đã duyệt vào kho tri thức. Ở LD-6 bước này là làn thứ ba trong Planning và là pull request thứ ba.
- Giữ nguyên các con số: 8 câu hỏi, v1 → v4, 33 test, lỗi D-1.

## 4. Ý tưởng hình ảnh

### 4.1 Bản đồ: xuất hiện suốt video

```
               TEAM CỦA BẠN (Admin · BA · Engineer · QC) · quyết định
                                   │
   CÔNG CỤ                         ▼             AGENT (máy của bạn)
   Jira · Azure DevOps · Teams ─┐            ┌─ BA · Requirements   (máy chủ)
   Confluence ──────────────────┼ AgentFlow ─┼─ Engineering · Code  (laptop của dev)
   Git ─────────────────────────┘ điều phối  └─ QC · Testing        (máy chủ test)
                                  + kết nối
                    ┆┄┄┄┄┄┄┄ hạ tầng của bạn (AgentFlow + agent) ┄┄┄┄┄┄┄┆
```

- **Người ở giữa → người ở trên.** Đầu video, ô giữa là một người đang chép qua chép lại. Ở C4, người đó rời ô giữa lên hàng trên; AgentFlow vào ô giữa. Video không nói "AI thay người". Nó nói AgentFlow thay phần chép-dán, còn người giữ phần quyết định.
- **Luật vẽ:** mọi đường từ agent đều đi qua hub, không nối thẳng tới Jira hay Confluence. Có một ngoại lệ, và vẽ đúng sự thật: agent Engineering chạy trên laptop (personal agent) tự push và mở pull request bằng tài khoản Git của chính developer. Vẽ nét đứt, nhãn "developer's own account".
- Nét đứt "Your infrastructure" bao AgentFlow và các agent. Jira, Confluence có thể là dịch vụ cloud nên nằm ngoài.

### 4.2 Agent là máy

Vẽ nét mảnh kiểu bản vẽ kỹ thuật, cùng phong cách la bàn/ống kính/khung dệt trong `apps/web/public/illustrations/`. Mỗi máy có:

- huy hiệu "tên · việc" theo màu vai trò: BA cyan, Engineering xanh, QC tím;
- dấu nhắc Claude Code;
- vòng trạng thái: xám (rảnh) · vòng gradient chạy (đang làm) · vàng (chờ người) · xanh lá (xong) · đỏ (lỗi).

### 4.3 Thẻ kỹ năng: đầu vào và đầu ra là "khớp nối"

Mỗi command là một hàng: tên command (mono) · ổ cắm **needs** bên trái · phích **makes** bên phải. Mỗi loại tài liệu có một biểu tượng với hình dạng riêng, tô màu theo agent tạo ra nó:

| Tài liệu | Hình | Màu (agent tạo ra) |
|---|---|---|
| Requirements (PRD) | trang có dòng chữ | cyan #00CCFE (BA) |
| Plan | danh sách check | xanh #355AE4 (Engineering) |
| Code | `</>` | xanh #355AE4 (Engineering) |
| Test plan | bảng ô | tím #9964E5 (QC) |
| Test results | bảng ô có ✓ | tím #9964E5 (QC) |

Khi ba thẻ xếp cạnh nhau, các đường chấm mảnh nối phích của thẻ này với ổ cắm của thẻ kia, vẽ ra đúng chuỗi bàn giao ở mục 3: BA → Engineering và QC; plan → (con dấu của người) → approved plan; test plan → `/qa-run`. Một command chỉ sáng lên khi ổ cắm needs của nó khớp với một tài liệu đã có trong lịch sử. Ai cũng hiểu luật khớp hình này mà không cần biết `needs`/`produces` là gì. Hình dạng khác nhau nên người mù màu vẫn phân biệt được.

### 4.4 Ba bảng và cổng

Khi ra quyết định, ba bảng (Quy tắc · Thẻ kỹ năng · Lịch sử) trượt ra quanh hub. Các dòng liên quan sáng lên và nối với nhau thành một **phiếu giao việc** (agent + command + đầu vào). Phiếu đi qua một **cổng** có ba đèn: *On a card* · *Read/Write* · *Inputs*. Đủ ba đèn xanh thì phiếu bay tới máy. Một đèn đỏ thì phiếu bị đóng dấu "Refused" và lịch sử có thêm một dòng.

### 4.5 Thanh flow

Ở C8, mỗi dòng của trang quy tắc co lại thành một ô, và các ô xếp thành một thanh chạy ngang phía trên khung hình:

```
Requirements [BA] → Planning [Engineering + QC] → Implement [Engineering] → Testing [QC] → Review [People] → Done
```

Thanh này ở lại suốt hồi 4:

- Ô hiện tại sáng; ô đã xong có ✓.
- Khi ticket bị trả về (Testing → Implement), vệt sáng lùi lại bằng một vòng cung.
- Chip vai trò trong ô dùng đúng màu agent, nên người xem luôn biết agent nào đang làm.

### 4.6 Logo khép lại

Ba màu của ba agent (cyan, xanh, tím) trên thanh flow bay lên thành ba đường mạch có nút tròn trong chữ "A" của logo (logo có đúng ba đường mạch). Cách diễn giải này cần người giữ brand đồng ý.

## 5. Cấu trúc (~2:18)

| Hồi | Thời gian | Cảnh | Nội dung | Cảm xúc / màu |
|---|---|---|---|---|
| 1. Vấn đề | 0:00–0:21 | C1–C3 | Agent giỏi, nhưng con người đang làm chất keo | nhanh → rối → khựng; xám, bão hoà thấp |
| 2. AgentFlow là gì | 0:21–0:44 | C4–C6 | Điều phối + kết nối; ba agent là ba máy của bạn | nhẹ nhõm; gradient thương hiệu xuất hiện |
| 3. Hai thứ bạn đưa cho nó | 0:44–1:00 | C7–C8 | Thẻ kỹ năng (agent khai), quy tắc (người viết) → thanh flow | rõ ràng, tĩnh |
| 4. Một ticket, ba agent | 1:00–2:03 | C9–C16 | BA → Engineering + QC → Engineering → QC ⇄ Engineering → người merge. Mỗi bước làm nổi một cơ chế: quy tắc → thẻ kỹ năng → guard → lịch sử | nhịp đều; căng nhẹ khi test lỗi; thoả mãn ở Done |
| 5. Thấy hết, trên hạ tầng của bạn | 2:03–2:11 | C17 | Agent nào đang làm, việc gì chờ người, tốn bao nhiêu | tự tin |
| 6. Kết | 2:11–2:18 | C18 | Logo + câu ba vế | đọng lại |

## 6. Kịch bản lời đọc (để review)

Nhịp tiếng Anh ~2.1 từ/giây (~290 từ), có chỗ thở cho nhạc. Bản tiếng Việt thường dài hơn 10–20%: đo bằng scratch VO rồi cắt chữ, không đọc nhanh hơn.

| # | Thời gian | EN (master) | VI |
|---|---|---|---|
| C1 | 0:00–0:05 | AI agents can now write requirements, code, and tests. | AI agent giờ đã viết được yêu cầu, code và cả test. |
| C2 | 0:05–0:13 | But someone still tells each one what to do — and copies the work between them and your tools. | Nhưng vẫn cần một người giao việc cho từng agent, rồi chép qua chép lại giữa chúng và công cụ của team. |
| C3 | 0:13–0:20 | Your team becomes the messenger. Who approved what? What did it cost? No one knows. | Cả team thành người đưa thư. Ai đã duyệt gì? Tốn bao nhiêu? Không ai nắm được. |
| C4 | 0:21–0:28 | AgentFlow takes over that job. It doesn't do the work — it coordinates the agents that do. | AgentFlow nhận lấy việc đó. Nó không tự làm — nó điều phối những agent làm việc. |
| C5 | 0:28–0:38 | An agent is a computer you own, running Claude Code. This team has three: BA for requirements, Engineering for code, and QC for testing. | Mỗi agent là một máy tính của bạn chạy Claude Code. Team này có ba agent: BA lo yêu cầu, Engineering viết code, QC kiểm thử. |
| C6 | 0:38–0:44 | AgentFlow holds the keys to your tools. Agents work through it. | AgentFlow giữ kết nối tới các công cụ của bạn. Agent làm việc thông qua nó. |
| C7 | 0:44–0:52 | Each agent publishes a skill card: its commands, what each one needs, and what it makes. | Mỗi agent công bố một thẻ kỹ năng: các command của nó, mỗi command cần gì và tạo ra gì. |
| C8 | 0:52–1:00 | Your rules say what happens at each step, and which role does it — in plain words. | Quy tắc của bạn nói mỗi bước làm gì, vai trò nào làm — bằng lời thường. |
| C9 | 1:00–1:05 | A ticket comes in: "Show me who on my team is off." | Một ticket đến: "Cho tôi xem lịch nghỉ của team." |
| C10 | 1:05–1:15 | AgentFlow reads the rules, the skill cards, and the ticket's history — and hands the job to the BA agent. | AgentFlow đọc quy tắc, các thẻ kỹ năng và lịch sử ticket — rồi giao việc cho agent BA. |
| C11 | 1:15–1:23 | The BA agent drafts the requirements and asks eight questions. People answer, edit the page, and approve. | Agent BA soạn bản yêu cầu và hỏi tám câu. Con người trả lời, sửa trang tài liệu, rồi duyệt. |
| C12 | 1:23–1:30 | At planning, Engineering and QC start at once — both need the requirements, and now they exist. | Đến bước lập kế hoạch, Engineering và QC cùng bắt đầu — cả hai cần bản yêu cầu, và giờ nó đã có. |
| C13 | 1:30–1:38 | Whatever the AI decides, a command that isn't on a card, or is missing its inputs, is refused. | Dù AI quyết định thế nào, command không có trên thẻ hoặc thiếu đầu vào đều bị chặn. |
| C14 | 1:38–1:45 | The Engineering agent, on a developer's laptop, writes the code and opens a pull request. | Agent Engineering, trên laptop của một developer, viết code và mở pull request. |
| C15 | 1:45–1:58 | The QC agent tests the code: one of 33 tests fails. Someone writes "fix D-1", and AgentFlow sends it back to the agent that wrote the code — Engineering. | Agent QC kiểm thử code: một trong 33 test thất bại. Có người viết "fix D-1", và AgentFlow gửi việc sửa về đúng agent đã viết code — Engineering. |
| C16 | 1:58–2:03 | Agents never merge. People review, merge, and close the ticket. | Agent không tự merge. Con người review, merge và đóng ticket. |
| C17 | 2:03–2:11 | You see which agent is working, what needs a person, and what it cost — all on your own servers. | Bạn thấy agent nào đang làm, việc gì cần người, tốn bao nhiêu — tất cả trên máy chủ của chính bạn. |
| C18 | 2:11–2:18 | Agents do the work. AgentFlow coordinates. People decide. | Agent làm việc. AgentFlow điều phối. Con người quyết định. |

Cảnh tuỳ chọn (+7s, chèn sau C16). Cảnh này cho BA xuất hiện lần nữa và cho thấy thêm một kiểu chọn agent: chọn theo agent đã viết ra tài liệu, và dùng command chỉ-đọc:

| # | EN | VI |
|---|---|---|
| C16b | Questions work the same way: ask about the requirements, and the BA agent that wrote them answers — read-only. | Câu hỏi cũng vậy: hỏi về bản yêu cầu thì agent BA, nơi viết ra nó, trả lời — chỉ đọc, không sửa gì. |

## 7. Storyboard

### C1 · 0:00–0:05 · Agent giỏi
- **Hình:** nền tối. Ba cửa sổ terminal nét mảnh, mỗi cửa sổ ghi nhãn theo việc: "Requirements", "Code", "Tests". Cả ba cùng lúc tuôn ra kết quả: một trang yêu cầu, một khối code, một bảng test. Mỗi kết quả bật ra (scale 0.96→1, 8 frame), lệch nhau 6 frame. Ba cửa sổ này về sau sẽ thành ba agent BA, Engineering, QC.
- **Âm:** gõ phím nhanh, ba tiếng "blip". Nhạc: nhịp tích tắc thưa.

### C2 · 0:05–0:13 · Người ở giữa
- **Hình:** camera lùi ra, lộ bản đồ: công cụ bên trái (Jira, Confluence, Git), ba cửa sổ bên phải, **một người** (avatar) ở ô giữa. Người đó chép ticket dán vào cửa sổ Requirements, chép kết quả dán vào Confluence, chép tiếp sang cửa sổ Code. Mũi tên chấm nhân lên; avatar rung, một đồng hồ nhỏ quay nhanh.
- **Chuyển động:** dồn dập, rung 1–2px, bão hoà giảm dần.
- **Chữ:** nhãn nhỏ "copy · paste" trên các mũi tên.
- **Âm:** thông báo chồng lên nhau, bị bóp nhỏ.

### C3 · 0:13–0:20 · Mất dấu
- **Hình:** hai thẻ hỏi bật lên đúng lúc lời đọc: "Who approved what?", "What did it cost?". Ở "No one knows" mọi thứ đứng hình.
- **Âm:** căng dần rồi cắt phụt. Im lặng 0:20–0:21.

### C4 · 0:21–0:28 · AgentFlow vào ô giữa
- **Hình:** trong khoảng lặng, người ở ô giữa bước lên hàng trên (hàng "decide"), cầm con dấu ✓. Hub AgentFlow (logo) trượt vào ô giữa. Các mũi tên chép-dán rút lại, thay bằng đường sạch mang gradient thương hiệu, đi qua hub. Nền chuyển sang graphite sạch, màu trở lại.
- **Chữ:** dưới hub: "Coordinate · Connect" / "Điều phối · Kết nối".
- **Âm:** whoosh và hợp âm ấm; nhạc chuyển sang giọng trưởng, beat vào.

### C5 · 0:28–0:38 · Ba agent, ba máy
- **Hình:** zoom sang phải. Ba cửa sổ hoá thành ba máy vẽ nét. Huy hiệu của từng máy hiện ra đúng lúc lời đọc gọi tên, theo màu vai trò:
  - **BA · Requirements**: rack máy chủ, cyan.
  - **Engineering · Code**: laptop của một developer, xanh.
  - **QC · Testing**: máy chủ test, tím.

  Trên mỗi màn hình có dấu nhắc Claude Code. Nét đứt "Your infrastructure" vẽ quanh ba máy và hub.
- **Chữ:** ba huy hiệu, bản VI: "BA · Yêu cầu", "Engineering · Viết code", "QC · Kiểm thử". Thêm nhãn nhỏ "Claude Code".
- **Âm:** ba tiếng khởi động nhẹ, mỗi máy một tiếng.
- **Kiểm chứng:** tên vai trò là chữ team tự đặt (`agent-capabilities.mdx`); LD-6 dùng BA / Dev / QC.

### C6 · 0:38–0:44 · Kết nối
- **Hình:** zoom sang trái. Các ô công cụ nối vào hub: Jira / Azure DevOps / Teams ("where work starts"), Confluence ("documents"), Git ("code"). Một biểu tượng chìa khoá đi vào hub và nằm lại đó. Một tia thử nối thẳng từ agent tới Jira mờ đi; mọi đường của agent quay về hub.
- **Chữ:** "Agents work through AgentFlow" / "Agent làm việc qua AgentFlow".
- **Âm:** một tiếng "khớp" khi mỗi công cụ nối vào.
- **Kiểm chứng:** chỉ nói AgentFlow giữ kết nối và khoá. Không nói "agent không có credential nào" (agent Engineering dùng tài khoản Git của chính developer, xem C14).

### C7 · 0:44–0:52 · Thẻ kỹ năng
- **Hình:** mỗi máy "in" ra một thẻ (góc thẻ ghi nhỏ `AGENTFLOW.md`). Thẻ bay về hub và xếp thành hàng. Command chỉ-đọc để mờ:
  - **BA · Requirements:** `/ba-requirement` → makes *requirements* · may ask questions. Mờ: `/leavedesk-research` · read-only.
  - **Engineering · Code:** `/writing-plans`: needs *requirements* → makes *plan*. `/executing-plans`: needs *approved plan* → makes *code* + pull request. Mờ: `/systematic-debugging` · read-only.
  - **QC · Testing:** `/qa-test`: needs *requirements* → makes *test plan*. `/qa-run`: needs *test plan* → makes *test results*. Mờ: `/qa-review` · read-only.

  Khi ba thẻ đã nằm cạnh nhau, đường chấm mảnh lần lượt nối phích với ổ cắm theo chuỗi bàn giao (mục 4.3): requirements của BA → `/writing-plans` và `/qa-test`; plan → con dấu ✓ của người → `/executing-plans`; test plan → `/qa-run`.
- **Chuyển động:** từng hàng command trượt vào, sau đó các đường nối vẽ dần.
- **Âm:** tiếng lật thẻ; tiếng "tách" nhỏ mỗi khi một đường nối khớp.
- **Kiểm chứng:** tên và khai báo command lấy đúng từ LD-6 (`docs/case-studies/ld-6-team-calendar/likec4/model.c4`). Thẻ trên hình là bản rút gọn: thẻ BA thật còn có `/ba-archive`.

### C8 · 0:52–1:00 · Quy tắc → thanh flow
- **Hình:** phía trên hub, một trang giấy tự gõ các dòng theo trạng thái ticket. Tên vai trò là chip màu, không có tên command:
  - Requirements: **BA** writes them and asks questions.
  - Planning: at the same time, **Engineering** plans the code and **QC** plans the tests.
  - Implement: **Engineering** builds from the plan.
  - Testing: **QC** runs the tests on Engineering's branch.
  - Review: **people** review and merge.

  Sau đó mỗi dòng co lại thành một ô, và các ô xếp thành **thanh flow** chạy ngang phía trên khung hình (mục 4.5).
- **Chữ:** các dòng trên; chú thích nhỏ "Roles, not commands" / "Vai trò, không phải command".
- **Âm:** tiếng gõ nhẹ; một tiếng "khớp" khi thanh flow hình thành.
- **Kiểm chứng:** rút gọn từ phần Flow trong quy tắc LeaveDesk. Quy tắc thật chỉ nêu vai trò.

### C9 · 1:00–1:05 · Ticket đến
- **Hình:** bên trái, thẻ ticket "LD-6 · As a manager, I want a calendar of who in my team is off" (VI: "Là quản lý, tôi muốn xem lịch ai trong team đang nghỉ"). Một con trỏ người kéo thẻ sang cột "Requirements"; một xung sáng chạy từ Jira vào hub. Trên thanh flow, ô Requirements sáng.
- **Âm:** tiếng thẻ đáp xuống, ping sự kiện.

### C10 · 1:05–1:15 · Giao việc cho BA (nhân vật chính: quy tắc)
- **Hình** (300 frame ở 30fps):
  1. f0–30: xung sự kiện tới hub: "LD-6 → Requirements".
  2. f30–100: bảng **Quy tắc** trượt ra bên trái hub. Dòng "Requirements: BA writes them" sáng, chip **BA** phát sáng. (khớp lời: "the rules")
  3. f100–170: bảng **Thẻ kỹ năng** trượt ra. Thẻ BA · Requirements sáng vì cùng vai trò; hàng `/ba-requirement` → makes requirements sáng. (khớp lời: "the skill cards")
  4. f170–230: bảng **Lịch sử** trượt ra: "LD-6 · no requirements yet" → nhãn "start new". (khớp lời: "the ticket's history")
  5. f230–280: ba điểm sáng nối thành phiếu giao việc "BA · /ba-requirement · LD-6", kèm nội dung ticket. Phiếu qua cổng, ba đèn xanh.
  6. f280–300: phiếu bay tới máy chủ BA; vòng trạng thái chuyển sang "đang chạy".
- **Chữ:** tên ba bảng: Rules · Skill cards · History / Quy tắc · Thẻ kỹ năng · Lịch sử.
- **Âm:** ba tiếng tick tăng dần cho ba bảng; một tiếng "chốt" khi phiếu qua cổng.
- **Kiểm chứng:** `apps/web/content/docs/guides/setup/orchestrator.mdx`: mỗi lượt, bộ điều phối đọc quy tắc, case và `AGENTFLOW.md`, rồi chọn command của agent. Agent không thấy Jira, nên quy tắc LeaveDesk yêu cầu đưa ticket vào phiếu giao việc.

### C11 · 1:15–1:23 · BA viết yêu cầu, con người duyệt
- **Hình:** máy BA làm việc. File yêu cầu đi về hub; hub đăng trang lên Confluence (nhãn v1). Bong bóng "8 questions" bay lên hàng người; câu trả lời bay về. Nhãn phiên bản chạy v1 → v2 → v3 → v4. Một con trỏ người sửa một dòng trên Confluence; dòng đó được tô và vẫn còn ở bản sau. Người kéo ticket sang Planning: con dấu ✓ "Approved". Trên thanh flow, ô Requirements có ✓.
- **Chữ:** "8 questions" · "v1 → v4" · pill "Approved".
- **Âm:** bong bóng pop, gõ phím, tiếng "cộp" của con dấu.
- **Kiểm chứng:** LD-6 case 1. Câu hỏi đăng ở đâu là do quy tắc của team quyết định (về sau LeaveDesk giữ câu hỏi trong AgentFlow), nên hình không khẳng định là đăng lên Jira; chỉ cần bong bóng đi tới hàng người.

### C12 · 1:23–1:30 · Engineering và QC cùng bắt đầu (nhân vật chính: thẻ kỹ năng)
- **Hình:** xung sự kiện "LD-6 → Planning" tới hub. Trên thanh flow, ô Planning sáng với hai chip Engineering và QC. Trên thẻ Engineering, hàng `/writing-plans` sáng; trên thẻ QC, hàng `/qa-test` sáng. Ổ cắm "needs requirements" của cả hai vươn dây về biểu tượng "Requirements v4 ✓" (màu cyan, do BA tạo) trong bảng Lịch sử và khớp vào (✓ xanh lá). Hai phiếu bay cùng lúc: một tới laptop Engineering, một tới máy chủ QC. Hai làn chạy song song.
- **Chữ:** "In parallel" / "Song song".
- **Âm:** hai nốt arpeggio, mỗi làn một nốt.
- **Kiểm chứng:** LD-6 case 2 và quy tắc "Planning: at the same time …, all with the PRD page". Bản video bỏ làn BA lưu trữ.

### C13 · 1:30–1:38 · Guard
- **Hình:** trong lúc hai làn đang chạy, hub (có biểu tượng AI nhỏ) gửi thử hai phiếu:
  - `/qa-run` gửi QC (cần *test plan*, nhưng QC chưa làm xong nên lịch sử chưa có): đèn *Inputs* đỏ, đóng dấu "Refused".
  - `/deploy` (không có trên thẻ nào): đèn *On a card* đỏ, đóng dấu "Refused".

  Mỗi lần chặn, lịch sử có thêm một dòng: "Refused · missing test plan", "Refused · not declared". Sau đó cảnh quay lại hai làn đang chạy.
- **Chữ:** ba đèn của cổng (On a card · Read/Write · Inputs); dấu "Refused".
- **Âm:** tiếng "bíp" từ chối trầm, không chói.
- **Ghi chú:** đây là cảnh minh hoạ, không phải sự kiện có thật trong LD-6. Nếu không muốn cho thấy bộ điều phối gửi lệnh sai, thay bằng cảnh cổng kiểm từng phiếu thật (ba đèn xanh) và một phiếu chung chung bị chặn.
- **Kiểm chứng:** phần guard trong `agent-capabilities.mdx` (Declared, Mode, Needs). Needs được kiểm theo tên file đầu vào, và chỉ với tag có command tạo ra file; task được resume thì không kiểm. Vì vậy không nói "AgentFlow kiểm tra nội dung hay chất lượng đầu vào".

### C14 · 1:38–1:45 · Engineering viết code
- **Hình:** hai trang "Implementation plan" và "Test plan" lên Confluence. Người chuyển ticket sang Implement (con dấu ✓). Trên thanh flow, ô Planning có ✓ và ô Implement sáng với chip Engineering. Phiếu `/executing-plans` (kèm trang kế hoạch) tới laptop Engineering. Trên laptop, các dòng diff "+" xanh chạy. Laptop push nhánh và mở pull request bằng đường nét đứt nối thẳng tới Git, nhãn "developer's own account".
- **Chữ:** thẻ PR "#6 · LD-6".
- **Âm:** gõ phím, tiếng "push".
- **Kiểm chứng:** LD-6 case 3. Với personal agent, command tự push và tự mở PR (trường `push` trong `agent-capabilities.mdx`).

### C15 · 1:45–1:58 · QC kiểm thử, việc sửa quay về Engineering (nhân vật chính: lịch sử)
- **Hình:**
  1. Người chuyển ticket sang Testing; trên thanh flow, ô Testing sáng với chip QC.
  2. Phiếu `/qa-run` (kèm test plan; lần này cổng xanh) tới máy QC. QC chạy test trên nhánh của Engineering: bộ đếm 1…32 ✓, ô 33 ✗ "D-1". Hub đăng trang "Test run 1" lên Confluence.
  3. Người chuyển ticket về Implement (vệt sáng trên thanh flow lùi một ô bằng vòng cung) và viết "fix D-1".
  4. Trong bảng Lịch sử, dòng "code ← Engineering" sáng lên. Một mũi tên cong quay về đúng laptop Engineering, kèm biểu tượng "resume" (tiếp tục phiên cũ). Engineering sửa xong.
  5. Người chuyển lại sang Testing; QC chạy lại: "33/33 ✓", trang "Test run 2".
- **Chữ:** "32/33" → "33/33 ✓"; dòng lịch sử "code ← Engineering".
- **Âm:** tích tắc bộ đếm, buzz nhẹ, gõ phím, chime đi lên.
- **Kiểm chứng:** LD-6 case 4 và 8 (chỉ sau khi người viết "fix D-1" thì việc sửa mới bắt đầu); cơ chế "Resume the right work" (việc sửa chạy tiếp trên agent đã làm, cùng phiên).

### C16 · 1:58–2:03 · Done
- **Hình:** hai thẻ pull request, "Code · Engineering" và "Tests · QC", pill vàng "In review". Con trỏ người bấm Merge từng thẻ; pill chuyển xanh "Merged". Ticket đáp xuống "Done"; thanh flow sáng hết từ đầu đến cuối. Cột công cụ hiện đủ kết quả: các trang Requirements, Implementation plan, Test plan, Test run 1–2 trên Confluence; comment trên Jira; 2 PR trên Git.
- **Chữ:** "Agents never merge." / "Agent không tự merge."
- **Âm:** hai tiếng click, chime "done", nhạc hit.
- **Kiểm chứng:** `concepts/people-in-the-loop.mdx` (agent mở PR, không merge); LD-6 case 5 (có 3 PR; bản rút gọn còn 2).

### C16b · tuỳ chọn, +7s · Hỏi đúng agent đã viết
- **Hình:** một comment hỏi về bản yêu cầu xuất hiện (câu hỏi minh hoạ). Lịch sử sáng dòng "requirements ← BA"; phiếu `/leavedesk-research` (nhãn "read-only") tới máy BA; câu trả lời quay về đúng thread đó.
- **Kiểm chứng:** quy tắc LeaveDesk ("ask the agent that wrote it", "answer each comment in its own thread"); command `mode: read` không được sửa file, commit hay push.

### C17 · 2:03–2:11 · Thấy hết
- **Hình:** camera lùi; bản đồ thu lại thành màn hình AgentFlow (dark theme, đơn giản hoá): sơ đồ Agents với ba máy BA, Engineering, QC (viền nét đứt chạy quanh agent đang làm), danh sách "Needs attention" (Waiting for a person), thẻ Usage (tokens, cost). Ba callout sáng lần lượt theo lời đọc. Cuối cảnh, nét đứt "Your infrastructure" sáng quanh hub và các máy.
- **Chữ:** các callout "Which agent is working" · "What needs a person" · "What it cost".
- **Âm:** tick UI cho mỗi callout.
- **Kiểm chứng:** `guides/operate/home.mdx`, `cases.mdx` (tab Agents), `sessions.mdx`. Không dùng lại mock `system-visual-section.tsx`: banner "N loops running" trong đó đã không khớp sản phẩm từ ISS-5355, và từ "Loops" đang được bỏ theo ISS-4477.

### C18 · 2:11–2:18 · Kết
- **Hình:** ba màu của ba agent trên thanh flow (cyan, xanh, tím) bay lên thành ba đường mạch có nút tròn trong chữ "A"; nét còn lại vẽ vào; logo hoàn chỉnh, wordmark hiện ra. Câu ba vế hiện theo nhịp lời đọc: "Agents do the work." · "AgentFlow coordinates." · "People decide." Sau đó là CTA.
- **Âm:** hợp âm kết, sting logo, đuôi nhạc 1.5–2s.

## 8. Bản cắt ngắn

### 60s

| Thời gian | EN | VI | Hình |
|---|---|---|---|
| 0:00–0:08 | AI agents can write requirements, code, and tests. But someone still has to coordinate them. | AI agent viết được yêu cầu, code và test. Nhưng vẫn cần người điều phối chúng. | C1–C2 rút gọn |
| 0:08–0:20 | AgentFlow does that. Your agents do the work — BA for requirements, Engineering for code, QC for testing — on your own computers. | AgentFlow làm việc đó. Các agent của bạn làm việc — BA lo yêu cầu, Engineering viết code, QC kiểm thử — trên chính máy tính của bạn. | C4–C5 |
| 0:20–0:40 | Each agent publishes a skill card. You write the rules in plain words. When a ticket moves, AgentFlow reads the rules, the cards, and the ticket's history, and sends the right command to the right agent. Anything not on a card is refused. | Mỗi agent công bố một thẻ kỹ năng. Bạn viết quy tắc bằng lời thường. Khi ticket đổi trạng thái, AgentFlow đọc quy tắc, các thẻ và lịch sử ticket, rồi giao đúng command cho đúng agent. Cái gì không có trên thẻ đều bị chặn. | C7, C8, C10, C13 |
| 0:40–0:52 | BA writes the requirements, Engineering builds, QC tests — and people answer, approve, and merge. | BA viết yêu cầu, Engineering viết code, QC kiểm thử — còn con người trả lời, duyệt và merge. | Thanh flow chạy hết C11–C16 |
| 0:52–1:00 | Agents do the work. AgentFlow coordinates. People decide. | Agent làm việc. AgentFlow điều phối. Con người quyết định. | C18 |

### 30s

| Thời gian | EN | VI | Hình |
|---|---|---|---|
| 0:00–0:07 | Your AI agents can do the work. But who coordinates them? | AI agent làm được việc. Nhưng ai điều phối chúng? | C2 (người ở giữa) |
| 0:07–0:21 | AgentFlow reads your rules, each agent's skill card, and the ticket's history — then hands each step to the right agent: BA, Engineering, or QC — and sends the results back to your tools. | AgentFlow đọc quy tắc, thẻ kỹ năng của từng agent và lịch sử ticket — rồi giao mỗi bước cho đúng agent: BA, Engineering hay QC — và đưa kết quả về công cụ của bạn. | C4, C10, thanh flow |
| 0:21–0:30 | Agents do the work. AgentFlow coordinates. People decide. | Agent làm việc. AgentFlow điều phối. Con người quyết định. | C18 |

### 15s, không lời

Chỉ có chữ và nhạc, dành cho autoplay tắt tiếng: "Your agents do the work." (ba máy BA · Requirements, Engineering · Code, QC · Testing sáng lên) → "AgentFlow coordinates." (ba bảng sáng, phiếu qua cổng, thanh flow chạy) → "Your people decide." (con dấu ✓) → logo.

### Loop 6–8s (README, landing)

Thanh flow chạy hết sáu ô; ở mỗi ô, máy của agent tương ứng sáng lên; lặp liền mạch.

## 9. Phong cách

### Màu

| Dùng cho | Giá trị | Nguồn |
|---|---|---|
| Đường flow, hub | #00CCFE → #01B8FC → #078AF5 | `packages/design-system/brand/agentflow-mark.svg` |
| Agent BA · Requirements | #00CCFE (màu đầu gradient logo) | logo |
| Agent Engineering · Code; primary (nút, pill) | oklch(0.528 0.214 267) ≈ #355AE4 | `packages/design-system/styles/globals.css` |
| Agent QC · Testing | đề xuất tím ≈ #9964E5 (oklch 0.62 0.19 300); designer chốt | mới |
| Nền | `.dark --background` oklch(0.24 0.005 270) ≈ #1E1F22; có thể đậm hơn một chút cho chất điện ảnh | globals.css |
| Trạng thái | success ≈ #36AD54 · warning ≈ #E1BD2B · destructive ≈ #ED3729 (dark theme) | globals.css |
| Hồi 1 | xám, bão hoà thấp | — |

Trạng thái "đang chạy" dùng vòng gradient động, không dùng xanh primary, để khỏi lẫn với màu agent Engineering.

### Chữ

Geist Sans (tiêu đề semibold, tracking hơi chặt), Geist Mono (tên command, "LD-6", "33/33"). Phải kiểm tra Geist có đủ dấu tiếng Việt trước khi khoá style; nếu thiếu, bản VI dùng font dự phòng có hỗ trợ tiếng Việt (ví dụ Be Vietnam Pro).

### Chuyển động

- Tiến trình đi trái → phải; quay lui là vòng cung phải → trái.
- Vẽ đường bằng stroke-dashoffset, tốc độ đều; nút bật scale 0 → 1.08 → 1.
- Easing khi vào: cubic-bezier(0.22, 1, 0.36, 1); spring cho thẻ UI, không nảy quá ~5%.
- Ở 30fps: chuyển động nhỏ 6–10 frame; thẻ vào 12–18 frame; chuyển cảnh 15–20 frame. Ưu tiên match-cut theo bản đồ thay vì fade.
- Chữ trên màn hình: tối đa ~7 từ mỗi lần; giữ ≥ 1.5s + 0.3s/từ. Với thẻ kỹ năng và bảng quy tắc (nhiều chữ), chỉ phần đang được nói mới sáng, phần còn lại để mờ.
- Hồi 1 được phép rung và chồng chéo; từ hồi 2 trở đi bám lưới, nhịp đều. Camera chỉ trượt và zoom 2.5D.
- Không nhấp nháy quá 3 lần/giây; ✓ và ✗ luôn có hình đi kèm màu.

### Khung hình

Master 16:9 được bố cục sẵn để dựng lại sang 9:16 và 1:1, không crop thô. Ở 9:16, bản đồ xếp dọc (người → công cụ → hub → agent) và thanh flow chuyển thành cột dọc bên trái. Ở 9:16, chừa ~10% phía trên và ~20% phía dưới. Chữ chính ≥ 48px khi chiều ngang là 1080.

## 10. Âm thanh

- **VO EN:** ấm, tự tin, giọng trò chuyện, không "bán hàng"; ~140–150 từ/phút.
- **VO VI:** tự nhiên, rõ, ấm.
- **Scratch VO:** dùng TTS cho animatic. Bản final dùng giọng thật (hoặc TTS có license thương mại nếu ngân sách hạn chế).
- **Nhạc:** electronic tối giản ~100–110 BPM, license phủ web + social + quảng cáo + sự kiện. Các mốc:
  - 0:20 cắt về im lặng; 0:21 vào giọng trưởng.
  - 1:05–1:15 ba nhịp tick cho ba bảng.
  - 1:23 thêm lớp khi hai làn Engineering và QC chạy song song.
  - ~1:50 lọc nhỏ khi test lỗi; ~1:56 bung khi 33/33.
  - 2:02 hit "Done"; 2:12 sting logo.
- **SFX:** một "họ" âm UI nhẹ, không trộn nhiều thư viện.
- **Mix:** -14 LUFS integrated, true peak ≤ -1 dBTP; nhạc duck ~-12 dB dưới lời.

## 11. Kiểm chứng nội dung (điều kiện để khoá kịch bản)

`apps/web/AGENTS.md` ghi nhận lỗi hay gặp nhất của docs là nói mạnh hơn những gì code thật sự làm. Video cũng dễ mắc lỗi đó. Mỗi câu khẳng định phải có nguồn (đường dẫn docs tính từ `apps/web/content/docs/`):

| Câu trong video | Nguồn | Giới hạn |
|---|---|---|
| AgentFlow không tự làm việc, nó điều phối (C4) | `guides/setup/orchestrator.mdx`; README của case study LD-6 ("no repository: only AgentFlow tools") | Bộ điều phối (Orchestrator Agent) cũng là Claude Code, chạy trên một agent riêng và chỉ có công cụ của AgentFlow. Video gộp nó vào "AgentFlow". Không được nói "AgentFlow không dùng AI" |
| Agent là máy tính của bạn chạy Claude Code (C5) | `reference/glossary.mdx`; `index.mdx` | Agent automatic có thể là container |
| Ba agent BA, Engineering, QC (C5) | `guides/setup/agent-capabilities.mdx`: vai trò là chữ team tự đặt, quy tắc gọi agent theo vai trò | LD-6 đặt tên Dev; video đổi thành Engineering |
| AgentFlow giữ kết nối và khoá tới công cụ (C6) | `integrations/index.mdx` ("credentials never leave the server"); `index.mdx` | Personal agent dùng tài khoản Git của chính người đó (C14). Không nói "agent không có credential nào" |
| Thẻ kỹ năng: command, cần gì, tạo ra gì (C7) | `guides/setup/agent-capabilities.mdx` | Thẻ trên hình là bản rút gọn |
| "approved plan" là đầu vào của `/executing-plans` (C7) | `model.c4` của LD-6 (`needs approved-plan`) | Không command nào tạo ra tag này nên guard không kiểm. Việc "đã duyệt" đến từ người chuyển trạng thái theo quy tắc. Vẽ con dấu của người giữa plan và approved plan là đúng; không nói guard kiểm việc duyệt |
| Quy tắc viết bằng lời thường, theo vai trò (C8) | `guides/setup/orchestrator.mdx`; quy tắc LeaveDesk | Chỉ đúng với workflow orchestrated (luồng video kể). Workflow run-based dùng các bước cố định viết trong YAML |
| Đọc quy tắc, thẻ kỹ năng, lịch sử rồi giao việc (C10) | `guides/setup/orchestrator.mdx` | |
| 8 câu hỏi, v1→v4, chỗ người sửa được giữ (C11) | case study LD-6, case 1 | |
| Engineering và QC cùng chạy khi đủ đầu vào (C12) | LD-6 case 2 | LD-6 có thêm làn BA lưu trữ; video bỏ |
| Chặn command không khai báo hoặc thiếu đầu vào (C13) | `agent-capabilities.mdx`, phần guard | Needs được kiểm theo tên file; tag không có command nào tạo ra, hoặc task được resume, thì không kiểm. Lệnh bị chặn được ghi "Refused" trên case |
| Agent Engineering trên laptop mở PR (C14) | LD-6 case 3; `agent-capabilities.mdx` (`push`) | |
| QC chạy test trên nhánh của Engineering (C8, C15) | mô tả `/qa-run` trong `model.c4` ("on its Dev branch") | |
| 32/33 → người viết "fix D-1" → việc sửa về đúng agent → 33/33 (C15) | LD-6 case 4 và 8; cơ chế "Resume the right work" | Việc sửa do người kích hoạt, không nói "tự sửa". Nếu agent cũ đã bị gỡ thì bắt đầu task mới |
| Agent không merge; 2 PR (C16) | `concepts/people-in-the-loop.mdx`; LD-6 case 5 | LD-6 có 3 PR; bản rút gọn còn 2 |
| Thấy agent nào đang làm, việc nào chờ người, chi phí (C17) | `guides/operate/home.mdx`, `cases.mdx`, `sessions.mdx` | Chỉ có chi phí khi Claude Code biết giá của model. Với provider tương thích khác (ví dụ DeepSeek), chi phí hiện là "unknown" |
| Trên máy chủ của chính bạn (C17) | README (self-hosted, không dùng AWS/Vercel) | Đúng với bản self-hosted, cũng là bản docs mô tả |
| Jira, Azure DevOps, Teams, Confluence, Git | `integrations/index.mdx` | Không vẽ GitLab, Slack, Linear: không có trong danh sách tích hợp |

Không được nói:

- "Code không bao giờ rời công ty": agent chạy Claude Code và gọi API của model (Anthropic hoặc endpoint tương thích).
- "Tự động hoàn toàn", "không cần người", "thay thế team".
- "AgentFlow luôn chọn đúng 100%": bộ điều phối là AI; guard chỉ bảo đảm ba điều nêu ở C13.
- Bất kỳ con số năng suất nào ("nhanh gấp 10 lần") khi chưa có dữ liệu.
- "Giới hạn ngân sách / chặn chi phí": ngân sách theo case hay project chưa được enforce.
- "Chỉ người có quyền mới duyệt được trong thread": `record_decision` dựa vào cách bộ điều phối đọc xem ai viết comment.
- "Chống prompt injection": nội dung ticket chỉ được đánh dấu là untrusted.

## 12. Cách sản xuất

### Đề xuất: Remotion trong monorepo + motion designer

Vì sao:

- Các cảnh cốt lõi (ba bảng, thẻ kỹ năng, cổng, thanh flow) bản chất là dữ liệu: flow ở mục 3, quy tắc, command và lịch sử khai báo một lần, rồi highlight theo timeline. Đổi tên agent, đổi command hay dịch sang tiếng Việt chỉ là đổi dữ liệu.
- Dùng lại được `@repo/design-system` (StatusIcon, token màu), font Geist và SVG logo.
- Render EN/VI và 16:9 / 1:1 / 9:16 từ cùng một composition; phụ đề SRT sinh từ cùng nguồn lời đọc.
- Version trong git, review bằng PR, render lại khi UI đổi. Render trên máy của mình, không dùng Remotion Lambda (khớp nguyên tắc không dùng AWS).

Lưu ý:

- Remotion yêu cầu company license khi công ty vượt ngưỡng nhân sự nhỏ (theo điều khoản hiện tại là trên 3 người). Kiểm tra và mua trước khi dựng.
- Chất lượng video do người thiết kế quyết định, không phải công cụ. Motion designer làm 6 styleframe (C2, C4, C7, C10, C15, C18) và animatic trước khi dev bắt tay dựng.
- Thêm `apps/video` là thay đổi nhiều file trong monorepo, nên làm qua quy trình `af-delivery`.

### Phương án khác

Thuê studio After Effects: phần minh hoạ đẹp hơn, nhưng sửa và bản địa hoá chậm và tốn kém. Nếu chọn hướng này, yêu cầu bàn giao project file và Lottie.

### UI sản phẩm (C17)

Dựng lại UI ở dạng đơn giản hoá bằng component: sắc nét, dịch được, không lộ dữ liệu. Nếu quay màn hình thì dùng dữ liệu demo LeaveDesk, dark theme, scale 2x, và không để lộ token hay URL nội bộ. Tên agent trong dữ liệu demo đặt theo vai trò BA · Requirements, Engineering · Code, QC · Testing cho khớp video.

### Tài liệu sẵn có

Mô hình LikeC4 của LD-6 (`docs/case-studies/ld-6-team-calendar/`, view "heart" và "mechSelection") là nguồn chuẩn cho cơ chế chọn agent. Có thể dùng tiếp làm bản demo sâu cho khán giả kỹ thuật.

## 13. Quy trình và tiến độ

| Tuần | Việc | Đầu ra | Cổng duyệt |
|---|---|---|---|
| 1 | Chốt mục 15; kịch bản v3; kiểm chứng theo mục 11 | Kịch bản khoá, EN + VI | G1: khoá kịch bản |
| 2 | 6 styleframe; storyboard; scratch VO; animatic có timing; test hiểu với 5 người ngoài ngành | Animatic ~2:18 | G2: khoá animatic (sửa sau mốc này rất tốn) |
| 3–4 | Dựng; thu VO EN và VI; chọn nhạc | Bản dựng đủ hình | G3: khoá hình |
| 5 | Âm thanh, mix; phụ đề; bản 60/30/15s và loop; 3 tỉ lệ khung; QA; test hiểu lần 2 | Toàn bộ deliverable | G4: duyệt cuối |

Vai trò: chủ dự án (định vị, CTA, duyệt), copywriter, motion designer, dev Remotion, người kiểm chứng (product + eng, theo mục 11 và UI), VO EN, VO VI, âm thanh.

## 14. Deliverables, đo lường, rủi ro

### Deliverables

| Bản | Tỉ lệ | Ghi chú |
|---|---|---|
| Master ~2:18 EN | 16:9, 1920×1080, 30fps | MP4 H.264 + ProRes 422 HQ để lưu trữ; một bản sạch (không phụ đề) + SRT EN/VI |
| Master VI | 16:9 | lồng tiếng Việt |
| 60s, 30s, EN và VI | 16:9, 1:1, 9:16 | phụ đề cứng cho social |
| 15s | 1:1, 9:16 | không lời |
| Loop 6–8s | 16:9 | GIF/WebM cho README, landing |
| Thumbnail | 1280×720 | |
| Source | — | project, asset, font, license nhạc |

### Đo lường

- **Hiểu:** 5 người ngoài ngành xem một lần; ít nhất 4/5 người trả lời đúng cả 4 câu ở mục 1. Câu 1 phải nêu được tên cả ba agent kèm việc của từng agent. Làm ở G2 và G4. Câu 3 khó nhất; nếu trượt, sửa C10 và C12 trước.
- **Giữ chân:** thời lượng xem trung bình ≥ 50%.
- **Hành động:** tỉ lệ click CTA; trên landing, so sánh tỉ lệ đăng ký và đọc docs khi có và không có video.

### Rủi ro

| Rủi ro | Giảm thiểu |
|---|---|
| Cảnh "vì sao chọn đúng" quá tải chữ | Chỉ phần đang nói mới sáng; mỗi bước chỉ làm nổi một nguồn; thanh flow giữ người xem biết đang ở đâu; test ở G2 |
| Nói quá khả năng sản phẩm | Mục 11 là điều kiện để qua G1 |
| Thuật ngữ len vào (kể cả "runner", "Dev" cho agent) | Bảng từ ngữ ở mục 2 |
| Tên vai trò trong video (Engineering) khác case study (Dev) | Ghi rõ trong mục 3; tài liệu demo dùng tên mới |
| UI và command thay đổi nhanh | Dựng bằng dữ liệu/component; UI ở dạng đơn giản hoá |
| Lệch thông điệp với hero "Stop burning tokens" | Chốt ở mục 15 trước G1 |
| Font thiếu dấu tiếng Việt | Kiểm tra trong tuần 2 |
| Logo bên thứ ba (Atlassian, Microsoft, GitHub, Bitbucket) và tên Claude Code | Theo brand guideline của từng bên; không chỉnh sửa logo; nếu không chắc thì chỉ dùng chữ |
| Video phình ra vì thêm tính năng | Cái gì ngoài 4 câu ở mục 1 thì để dành cho series sau |

### Series sau (ngoài phạm vi)

- Demo 3–5 phút đi hết LD-6 bằng mô hình LikeC4.
- Spot 60s "Sessions và chi phí" (góc "Stop burning tokens") cho lãnh đạo kỹ thuật.
- Spot về personal agent (agent Engineering trên laptop).
- Spot về nhiều comment cùng lúc và lỡ tay đổi trạng thái, dành cho người vận hành.

## 15. Quyết định cần chốt

| # | Câu hỏi | Đề xuất |
|---|---|---|
| 1 | Câu kết | "Agents do the work. AgentFlow coordinates. People decide." Phương án thay thế: "AI agents do the work. People govern it." (deck LD-6) |
| 2 | Độ dài master | ~2:18, vì phải giới thiệu ba agent và giải thích cơ chế chọn agent. Nếu cần ≤ 2:05: bỏ C13 và C16; ngắn hơn nữa thì dùng bản 60s |
| 3 | Flow rút gọn bỏ bước BA lưu trữ (`/ba-archive`) | Bỏ: flow dễ theo hơn và vẫn dùng cả ba agent. Nếu cần khớp tuyệt đối với case study, thêm lại làn thứ ba ở Planning và PR thứ ba |
| 4 | Có hiện tên command thật trên thẻ (`/ba-requirement`, `/writing-plans`, `/qa-test`…) không | Có. Đúng ý "command nào của agent nào"; người không làm kỹ thuật vẫn đọc như một cái tên |
| 5 | Có nói rõ bộ điều phối là AI không ("Whatever the AI decides", C13) | Có, nói nhẹ. Nó giải thích vì sao quy tắc viết bằng lời thường được, và guard cho thấy giới hạn cứng |
| 6 | C13 có cho thấy bộ điều phối gửi lệnh sai rồi bị chặn không | Có, để minh bạch. Phương án nhẹ hơn nằm ở ghi chú của C13 |
| 7 | Có thêm cảnh tuỳ chọn C16b (BA trả lời câu hỏi) không | Không cho master; dùng trong bản demo sâu |
| 8 | Góc định vị so với hero landing | Video mở bằng góc điều phối. Xem lại hero, hoặc đặt video ở mục khác trên trang |
| 9 | Ngôn ngữ | Master EN + bản VI |
| 10 | Cách sản xuất | Remotion + motion designer |
| 11 | CTA và URL | Cần chốt. Repo chưa có domain production. Link GitHub trên website (`github.com/agentflow-ai`) khác README (`github.com/daominhsangvn/agentflow`). CTA cuối landing còn nhắc "hosted version", trong khi docs chỉ mô tả bản self-hosted. Có thể thêm "Open source · MIT" (LICENSE là MIT) |
| 12 | Ẩn dụ logo (ba màu agent → ba đường mạch) | Có, nếu người giữ brand đồng ý |
