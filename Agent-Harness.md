# Agent Harness — Tổng quan nghiệp vụ

Hệ thống agent đang chạy những luồng gì, xử lý ra sao, mạnh ở đâu, còn hở ở đâu.
Bản này để **trình bày và ra quyết định**, không phải tài liệu kỹ thuật.

> Chi tiết kỹ thuật → `Documentation.md` · Luật bắt buộc khi sửa engine →
> `ticket-executor/CLAUDE.md` · Việc còn lại → GitHub issue #83–#87.

**Cập nhật:** 2026-08-06

---

## 1. Hệ thống làm gì

Chọn một ticket trong sprint, bấm một nút. Hệ thống mở một agent chạy ngay trong
bản clone của repo để nó đọc ticket, khảo sát code, viết code, tự kiểm tra, commit,
push và mở pull request — rồi ghi lại toàn bộ chi phí, thay đổi và kết quả.

Điều quan trọng nhất về định vị: **mốc so sánh không phải "làm tay"**, mà là "tự mở
CLI chạy từng phiên một". Mọi giá trị hệ thống cộng thêm đều nằm trên mốc đó: chạy
nhiều ticket song song, chặn trước những lần chạy chắc chắn thất bại, có điểm dừng
cho con người duyệt, và có sổ sách cho từng lần chạy.

---

## 2. Bốn luồng nghiệp vụ đang dùng

Hai nghiệp vụ, mỗi nghiệp vụ hai chế độ. Chế độ chọn trong Settings.

| | **AUTO** — chạy một phát | **PLAN** — dừng cho người duyệt |
|---|---|---|
| **Implement ticket** | Đọc ticket → code → kiểm tra → mở PR, không dừng | Soạn kế hoạch → **người duyệt** → code → mở PR |
| **Resolve code review** | Đọc mọi comment trên PR → sửa → trả lời → đóng thread | Soạn kế hoạch xử lý từng comment → **người duyệt** → sửa → trả lời |

Mặc định hiện tại là **AUTO** cho cả hai — xem §6 để biết cái giá.

Có thêm một tuỳ chọn **đang tắt sẵn**: chèn một **người review độc lập** (một agent
khác, không thấy quá trình viết code) vào giữa "code xong" và "mở PR". Nó chỉ đọc,
không sửa. Nếu nó phản đối thì code được sửa lại tối đa 2 vòng; vẫn không đạt thì
lần chạy đó dừng chứ không mở PR.

---

## 3. Một ticket đi qua những bước nào

**Chế độ PLAN** (có điểm dừng cho người):

1. **Kiểm tra trước** — repo có đúng chỗ không, agent có đường tới hệ thống ticket
   không, ticket này có đang chạy dở không. Sai ⇒ chặn ngay, **chưa tốn đồng nào**.
2. **Soạn kế hoạch** — agent đọc ticket, khảo sát code, viết ra kế hoạch. Chưa được
   sửa một dòng code nào.
3. **Người duyệt** — kế hoạch hiện lên UI: **Duyệt** · **Yêu cầu sửa** (ghi lý do,
   agent viết lại rồi trình lại) · **Huỷ**. Trong lúc chờ, hệ thống không giữ tiến
   trình nào và không tốn tiền — chờ bao lâu cũng được, kể cả qua lần khởi động lại
   máy chủ.
4. **Viết code** — tạo branch, code theo kế hoạch đã duyệt (bạn sửa kế hoạch thì
   bản đã sửa mới là bản có hiệu lực), tự chạy kiểm tra, commit **tại máy**. Chưa
   có gì rời khỏi máy.
5. **Cổng chất lượng** — agent báo test hoặc build **fail** ⇒ **dừng tại đây**.
   Không push, không PR.
6. **Công bố** — push branch, mở PR, gắn link ticket. Đây là bước duy nhất có tác
   động ra bên ngoài, và nó chạy đúng một lần.

**Chế độ AUTO**: gộp bước 2–6 thành một lần chạy liền mạch, không có điểm dừng.

Mọi lần chạy để lại **sổ ghi từng bước**: đi từ bước nào sang bước nào và **vì
sao**. Đó là thứ biến "agent làm gì đó rồi ra kết quả" thành quy trình kiểm toán
được.

---

## 4. Chạy một ticket hay nhiều ticket

| | **Một ticket** | **Nhiều ticket** (mặc định) |
|---|---|---|
| Chạy ở đâu | Trực tiếp trong repo của bạn | Mỗi lần chạy có bản làm việc riêng |
| Song song | Không — đúng một lần chạy toàn hệ thống | Nhiều, tối đa theo hạn mức trong Settings |
| Ảnh hưởng repo của bạn | ⚠️ Có — branch đang mở bị đổi | Không |
| Chạy hàng loạt | Tắt | Bật (chọn nhiều ticket → chạy) |

Luật áp dụng ở **cả hai** chế độ: **một ticket chỉ được có một lần chạy đang dở** —
hai lần chạy trên cùng một ticket sẽ tranh nhau cùng một tên branch.

---

## 5. Những chỗ hệ thống tự dừng lại

| Chặn cái gì | Khi nào |
|---|---|
| Cấu hình sai (repo, kết nối, ticket đang chạy, vượt hạn mức song song) | Trước khi tốn token |
| Kế hoạch chưa ổn | Người duyệt bấm Yêu cầu sửa / Huỷ |
| Test hoặc build fail | Trước khi push — **chỉ ở chế độ PLAN** |
| Người review độc lập phản đối | Trước khi push, nếu bật tuỳ chọn |
| Chi phí vượt trần một lần chạy | Giữa hai bước, không cắt ngang bước đang chạy |
| Quy trình lặp vô hạn | Đạt giới hạn số bước |
| Máy chủ sập giữa lúc chạy | Chưa đẩy gì ra ngoài ⇒ **tự tiếp tục**. Đã có thể đẩy rồi ⇒ **chờ người kiểm**, không tự thử lại — tự thử lại là cách sinh PR trùng |

---

## 6. Ưu điểm

- **Chặn sớm, rẻ.** Một lần chạy sai cấu hình bị từ chối khi chưa tốn token; cùng
  lỗi đó nếu tự chạy CLI sẽ tốn cả một phiên để chết ở lệnh git đầu tiên.
- **Người duyệt đúng chỗ đắt nhất** — duyệt *kế hoạch*, trước khi code được viết,
  chứ không phải review PR sau khi đã viết xong.
- **Không có gì rời khỏi máy sớm.** Push / mở PR / ghi lên hệ thống ticket bị dồn
  vào một bước duy nhất ở cuối, chạy đúng một lần.
- **Sập không mất việc.** Lần chạy đang chờ người duyệt sống qua khởi động lại; lần
  chạy đang code thì tự tiếp tục.
- **Có sổ sách.** Mỗi lần chạy lưu: đi qua những bước nào và vì sao, chi phí, số
  file/dòng thay đổi, kế hoạch agent đề xuất **và** bản người duyệt đã sửa — giữ
  riêng hai bản để đối chiếu được về sau.
- **Đo được, không phải cảm tính.** Dashboard đo cả hai vế: chất lượng (tỉ lệ đúng
  ngay lần đầu, tỉ lệ phải làm lại) và chi phí (mỗi ticket ship được tốn bao nhiêu)
  — đủ để bật/tắt một tính năng rồi so số.

---

## 7. Lỗ hổng còn lại

| Lỗ hổng | Nghĩa thực tế | Xử lý |
|---|---|---|
| **AUTO không chặn được test fail** | Ở AUTO, code và mở PR nằm trong cùng một lượt, nên khi hệ thống biết test fail thì PR đã mở rồi. Nó báo lần chạy đó **thất bại** và không đẩy ticket sang Code Review — nhưng PR vẫn tồn tại. Đây là **giới hạn bản chất**, không phải bug: muốn có cổng chặn thật thì dùng PLAN | Quyết định sản phẩm — mặc định vẫn AUTO |
| **Chưa từng chạy thật bằng token** | Toàn bộ đợt sửa vừa rồi chỉ được kiểm bằng test tự động và build. Hai điều quan trọng nhất — chạy bước công bố hai lần ra đúng 1 PR, và sập giữa lúc công bố thì không tự thử lại — chưa được xác nhận trên repo thật | **#83** |
| **Mỗi lần chạy bắt đầu từ số không** | Không ghi nhớ gì giữa các lần chạy: mọi ticket đọc lại repo từ đầu. Đây là khoản token lặp ở **mọi** lần chạy, và với repo lớn thì nó lớn nhất | **#84** |
| **Chỉ chạy đúng một máy chủ** | Mở hai máy chủ trên cùng cơ sở dữ liệu thì cả hai đều tưởng mình đang điều khiển, không ai phát hiện | **#85** |
| **Hàng đợi chạy hàng loạt mất khi F5** | Ticket đã bắt đầu vẫn chạy tiếp, nhưng không ai kéo ticket kế tiếp vào. Đóng tab thì hàng đợi dừng | **#86** |
| **Không tự chọn việc** | Hệ thống chỉ chạy khi có người bấm. Chưa có cơ chế tự nhìn sprint và tự quyết ticket nào đủ rõ để làm | **#87** |

Thứ tự nên làm: **#83 → #84 → #85 → #86 → #87**. #83 đứng đầu vì mọi thứ vừa xây
đều chưa được chứng minh bằng một lần chạy thật.
