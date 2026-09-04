# D-Agent (Ticket Executor)

## 1. Giới thiệu về ứng dụng

**D-Agent** là ứng dụng web nội bộ giúp đội phát triển **chuyển ticket thành Pull Request**
bằng AI agent (Claude Code CLI) — thay vì lập trình viên phải tự mở terminal và gõ lệnh cho từng ticket.

Chọn ticket từ Azure DevOps → bấm một nút → hệ thống tự động tạo nhánh, viết code, chạy kiểm tra,
commit, push, mở PR; đồng thời phát trực tiếp log, tiến độ, token và chi phí lên giao diện.

**7 màn hình chính:**

| Màn hình | Dùng để |
|---|---|
| **Home** | Điểm vào, trạng thái kết nối hiện tại |
| **Projects** | Danh sách project của tổ chức; chọn một để bắt đầu |
| **Ticket Execution** | Màn hình trung tâm — chọn ticket, chạy, theo dõi, phê duyệt |
| **Dashboard** | Thông lượng, chất lượng, chi phí, ROI |
| **Guide** | Hướng dẫn thiết lập theo bước |
| **System Check** | Kiểm tra sẵn sàng trước khi chạy (không tốn token) |
| **Settings** | Kết nối, mức tự động, ROI, hiển thị |

**Hai hành động trên một ticket:**

| Hành động | Áp dụng cho trạng thái | Kết quả |
|---|---|---|
| **Implement Ticket** | Ready for Dev / In Progress / Active / Todo | Branch + code + PR |
| **Resolve Review** | Code Review / In Review / Peer Review / Resolved | Sửa theo comment + trả lời thread |

---

## 2. Hướng dẫn sử dụng

### Bước 0 — Chuẩn bị một lần

| # | Việc cần làm |
|---|---|
| 1 | Cài AI CLI và đăng nhập |
| 2 | Cài 4 skill quy trình trên máy: `implement-ticket-v2/v3`, `fix-code-review-v2/v3` |
| 3 | Clone repo mục tiêu; cây làm việc **sạch**, và `git push` chạy được **không cần nhập tay** |
| 4 | Tạo PAT Azure DevOps: **Work Items** (đọc/ghi), **Code** (đọc/ghi), **Pull Request** (đọc/ghi/quản lý) |
| 5 | Vào **Settings → Connection**: chọn Azure DevOps, nhập **URL cấp tổ chức** (không phải URL project) + PAT → **Test connection** → **Save** |
| 6 | Vào **System Check**, đảm bảo không còn **FAIL** trước khi chạy ticket đầu tiên |

### Bước 1 — Chọn mức tự động (Settings → Execution)

| Cấu hình | Chọn khi |
|---|---|
| **Auto implement = ON** | Ticket nhỏ, rủi ro thấp → chạy thẳng tới PR, không dừng |
| **Auto implement = OFF** | Ticket phức tạp → dừng lại cho bạn **phê duyệt kế hoạch** trước khi sửa code |
| **Multi-ticket mode = ON** (mặc định) | Cho phép chạy nhiều ticket song song, mỗi lần chạy một worktree riêng |
| **Concurrent runs** | Giới hạn số lần chạy đồng thời |

### Bước 2 — Chạy một ticket

1. **Projects** → chọn project (tự điều hướng sang Ticket Execution).
2. Trên header, chọn **Sprint / Backlog / Board** và chọn ticket ở danh sách bên trái.
3. Tab **Overview**: điền **Root repo** — đường dẫn clone git (ví dụ `C:\repos\my-service`),
   xác nhận **Skill**, xem trước lệnh sẽ chạy.
   > Root repo là giá trị **theo từng ticket**, nhập một lần cho mỗi project rồi hệ thống tự điền lại.
   > Còn trống thì bị đánh dấu `REQUIRED` và nút chạy sẽ nhắc thay vì chạy.
4. Bấm nút hành động chính (**Implement Ticket** / **Resolve Review**).

### Bước 3 — Phê duyệt kế hoạch (nếu bật chế độ có chốt)

Lần chạy **đậu lại** ở trạng thái *Awaiting your review*. Mở tab **Plan**, đọc và sửa trực tiếp
nếu cần, rồi chọn:

| Nút | Kết quả |
|---|---|
| **Accept** | Triển khai theo kế hoạch |
| **Request changes** | AI lập lại kế hoạch |
| **Cancel** | Dừng hẳn |

> Trong lúc chờ, lần chạy **không giữ tiến trình nào** → không tốn chi phí

### Bước 4 — Theo dõi và kiểm tra kết quả

| Tab | Xem gì |
|---|---|
| **Execution** | Log trực tiếp, danh sách bước và trạng thái từng bước |
| **Result** | Tóm tắt, diff, thời lượng, token, chi phí, link PR |
| **Commits** | Commit và file đã thay đổi thực tế |
| **Resolve Review** | Các luồng comment review đang mở trên PR |

Sau khi PR được tạo, ticket chuyển sang **Code Review**. Xem tổng hợp nhiều lần chạy ở **Dashboard**.

### Lưu ý vận hành quan trọng

- ⚠️ **Ứng dụng thay đổi thật** trên repo và tracker (commit, push, PR). Lần đầu hãy trỏ vào **repo nháp**.
- Chỉ chạy **một bản** ứng dụng mỗi phiên (host **hoặc** container, không cả hai) — nếu không,
  hai tiến trình sẽ cùng push một branch.
- Tin **System Check**, không tin dropdown skill: dropdown có thể hiện skill chưa cài trên máy.
- **Không có ngưỡng chi phí cứng** — kiểm soát bằng Dashboard, giới hạn concurrent runs và nút **Cancel**.

---

## 3. Giá trị mang lại — vì sao nên dùng

### 3.1 Năm giá trị cốt lõi

| Giá trị | Trước (gõ CLI tay) | Với D-Agent |
|---|---|---|
| **Song song hoá** | 1 dev = 1 phiên = 1 ticket tại một thời điểm | Nhiều ticket chạy cùng lúc, mỗi ticket một worktree riêng — không xung đột |
| **Chốt kiểm soát** | Phát hiện AI đi sai hướng **sau khi** đã tốn cả phiên | Phê duyệt *kế hoạch* trước khi AI được sửa code; chờ không mất tiền |
| **Chặn trước khi tiêu hao token** | Sai repo / thiếu quyền / thiếu skill → tốn token rồi mới fail | Từ chối **trước khi** khởi chạy → chi phí bằng 0, và ghi nhận lại để báo cáo |
| **Đo lường được** | Không có số liệu nào | Mọi lần chạy sinh dữ liệu: thời gian, token, chi phí, rework, ROI |
| **Khả năng phục hồi** | App/máy sập là mất phiên | Tự phục hồi theo bản chất bước đang dở; **không bao giờ tạo PR trùng** |

### 3.2 Nghiệp vụ được tự động hoá

Ngoài việc viết code, hệ thống làm luôn phần thủ công quanh nó: tạo branch theo quy ước,
commit, push, **tạo PR và mô tả PR**, chuyển trạng thái ticket, đọc comment review — sửa —
trả lời thread.

### 3.3 Trả lời được câu hỏi của quản lý

Dashboard 3 tầng cho ra con số, không phải cảm nhận:

| Tầng | Câu hỏi trả lời | Chỉ số tiêu biểu |
|---|---|---|
| **Giá trị** | Ứng dụng thêm gì so với gõ CLI tay? | Hệ số nén, đỉnh song song, giờ tiết kiệm, **chi phí đã tránh được**, số phiên đã phục hồi |
| **Chất lượng** | Chất lượng đầu ra thế nào? (đo theo **ticket**, không theo lần chạy) | **Tỉ lệ đạt ngay lần đầu**, **hệ số rework**, tỉ lệ kế hoạch được duyệt, số lần bị chặn do test/build fail |
| **Vận hành & ROI** | Có đáng tiền không? | **Chi phí mỗi ticket ship được**, lãi/lỗ thuần, hệ số nhân ROI, funnel PR tạo → merge, độ nhất quán theo skill |

### 3.4 An toàn theo thiết kế

| Luật | Ý nghĩa với bạn |
|---|---|
| Hành động ra bên ngoài (push/PR/ghi tracker) chỉ vào **một lần**, không nằm trên vòng lặp thử lại | **Không bao giờ tạo PR trùng** |
| Bước đã ra ngoài mà bị ngắt → **không tự thử lại**, chuyển sang chờ người xem | Con người luôn là người xác nhận ở ranh giới rủi ro |
| Một ticket chỉ có một lần chạy đang hoạt động | Không có hai tiến trình cùng sửa một ticket |
| PAT mã hoá khi lưu, không trả về trình duyệt; cấu hình MCP tạm thời nằm ngoài repo | Bí mật không bị lộ và không bị `git add` nhặt vào |

### 3.5 Tích luỹ theo thời gian

Những gì các lần chạy trước học được về một repo (quy ước, cạm bẫy, cách chạy test) được lưu lại
và gộp trùng — cùng một bài học từ 10 lần chạy là **một bản ghi với số lần gặp = 10** — rồi nối vào
prompt đầu tiên của lần chạy sau. Càng dùng, mỗi lần chạy càng đúng ngữ cảnh dự án.

---

