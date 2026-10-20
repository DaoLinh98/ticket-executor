# Plan — Một run implement ticket trên nhiều repo (Root repo + companion repos)

Bối cảnh: ticket RIS #25691 cần sửa cả `RIS` (endpoint dữ liệu) và `ReportingService`
(slide 7 trong `Functions/ManagedMoneyFunction`). Run `cmv7k1po90002ovz89ai56332` đã `cd`
sang ReportingService, đọc code, rồi tự đưa phần đó vào "Out of scope" và vẫn publish
với `acceptanceCriteria: "partial"`. Mục tiêu: **một run làm xong mọi repo ticket cần,
qua cùng test gate + reviewer, và mở một draft PR cho mỗi repo.**

---

## 1. Vì sao chạy tay bằng `~/.claude/skills/implement-ticket` lại làm đủ cả 2 repo

| Khía cạnh | `implement-ticket` (CLI tay) | `implement-ticket-v4` (D-Agent) |
|---|---|---|
| Đọc guidance | "instruction files **in or above the directories you will modify**" → đọc cả CLAUDE.md của ReportingService | Chỉ root `CLAUDE.md`/`AGENTS.md` của cwd + file trong thư mục đang sửa |
| Phạm vi | Không có template Out of scope; thiếu thông tin thì *dừng phần đó và hỏi* | Template plan có sẵn **Out of scope**; Autonomy: "pick the most reasonable interpretation, proceed, record the assumption" |
| Branch / commit | "Commit on the currently checked-out branch" — không gắn với 1 repo, người dùng commit từng repo | 1 lệnh `git checkout -b` "from the current HEAD" mà runner đã đặt sẵn → ngầm định 1 repo |
| Output | Bảng tự do, người đọc thấy ngay "Partial" | JSON contract chỉ có **một** `branch`; `partial` không bị edge nào chặn |
| Sau implement | Người dùng tự push/PR từng repo | `check`/`evaluate` chỉ diff `cwd`, `publish` chỉ push branch của `cwd` |

Kết luận: CLI tay làm được vì **không có gì ràng buộc vào 1 repo và có người đứng sau
kiểm tra**. D-Agent thì mọi khâu sau `implement` đều là 1 repo, nên agent "khôn ngoan"
tránh để lại commit mồ côi mà không ai test, review hay publish.

### Đánh giá các hướng theo công sức

| Hướng | Công sức | Đánh giá |
|---|---|---|
| A. Chỉ sửa skill cho phép sửa repo khác (bắt chước CLI tay) | Rất thấp | **Không đủ.** Commit ở repo 2 không qua test gate/reviewer, không được push/PR, release không publish; ở multi-ticket mode agent sẽ sửa thẳng checkout của dev trong khi run khác chạy song song. |
| **B. Companion repos khai báo + harness tự đo git từng repo** (đề xuất) | Trung bình (~12 file, 1 migration) | Giữ nguyên `prUrl` chính (125 chỗ dùng không phải đụng), contract implement **không đổi**, chỉ publish thêm `prs[]`. |
| C. Đổi `prUrl`/`branch` thành mảng xuyên suốt app | Cao | Không cần: 125 chỗ dùng `prUrl` (Result tab, review bell, funnel…) chỉ cần PR chính. |

---

## 2. Thiết kế (hướng B)

### Nguyên tắc
1. **Repo phụ lấy từ chính file md của Root repo, dev không phải khai báo.** Trước khi spawn,
   harness (code, 0 token) quét `CLAUDE.md`, `AGENTS.md`, `.claude/CLAUDE.md` của Root repo,
   lấy mọi đường dẫn tuyệt đối trỏ tới một git repo khác trên máy → đó là *repo được phép*.
   Harness validate, lấy `baseSha`, tạo worktree cho tất cả (rẻ); **agent tự quyết** ticket cần
   repo nào, harness chỉ test/review/publish repo thực sự có commit. File md là nguồn sự thật
   do dev sở hữu, nên guard "fail before spawn" vẫn giữ mà không ai phải nhập tay.
2. **Harness tự đo git, không tin agent kể** (invariant 6). Repo nào có commit sau `baseSha`
   là repo đã thay đổi — tính bằng `git rev-list`, không thêm field vào contract implement.
3. **Root repo vẫn là chủ**: `KNOWLEDGE.md`, `.te/plan.md`, `Run.prUrl` chính (PR của root
   nếu root có thay đổi, ngược lại PR đầu tiên của companion).
4. **Không có companion → hành vi y hệt hôm nay.** Run cũ (v5) resume sau restart vẫn chạy
   đúng vì danh sách companion của nó rỗng → không cần bump graph id.

### Luồng mới
```
startRun: quét md của root → companions → validate → baseSha từng repo → (isolate) worktree từng repo
implement: prompt có "Repos: ReportingService=<cwd> base=<sha>; ..." → agent sửa + commit mỗi repo, cùng tên branch
check:    với MỖI repo có commit: testGap(changedFiles(repoCwd, base)) ; + chặn AC partial
evaluate: prompt liệt kê mọi repo + base → reviewer diff từng repo
publish:  push + draft PR cho từng repo có commit → prUrl (chính) + prs[]
edge publish: mọi repo có commit phải có PR pushed trong output, đối chiếu với git do harness đo
release:  publish/reviewers cho prUrl + companionPrUrls
```

---

## 3. Thay đổi chi tiết

### Phase 0 — Lưới an toàn AC (làm độc lập, nên làm trước, ~nửa ngày)
Có giá trị ngay cả khi chưa có multi-repo: không bao giờ còn PR "thiếu nửa ticket" lặng lẽ.

| # | File | Thay đổi |
|---|---|---|
| 0.1 | `lib/execution/graph/graphs.ts` — `committedLocally` | `acceptanceCriteria === "partial"` → `fixBound(c, "acceptance criteria partial")` (không đi tiếp `check`). `cannot-verify` vẫn cho qua (UI-only, v.v.). |
| 0.2 | `lib/execution/graph/prompts.ts` — `fixPrompt` | Nhánh mới khi refusal là AC partial: liệt kê `deviations` của `implement`/`fix`, yêu cầu hoàn thành AC còn thiếu **hoặc** set `blocked` với lý do cụ thể (vd. repo cần sửa không có trong `Repos:`). |
| 0.3 | `lib/execution/graph/graphs.ts` — `standingRefusal` | Thêm case AC partial để `reflect`/FAIL có lý do đúng. |
| 0.4 | `skills/implement-ticket-v4/SKILL.md` (bump `version`) | Rule: *"Không được đưa một Acceptance Criterion vào Out of scope vì nó nằm ở repo khác. Out of scope chỉ dành cho việc ticket không yêu cầu."*; báo `partial` khi còn AC chưa làm. |
| 0.5 | `skills/review-changes-v4/SKILL.md` (bump `version`) | "A missed AC" gồm cả AC bị plan đẩy sang repo khác; reviewer đọc `.te/plan.md` mục Out of scope và đối chiếu với AC. |
| 0.6 | `tests/graphs*.test.ts` | Edge test: partial → fix; partial sau `MAX_FIX_ATTEMPTS` → reflect → FAIL; cannot-verify → check. |

> Bump version skill: `skillProblem()` sẽ refuse admission nếu bản cài thấp hơn bản bundled → `instrumentation.ts` cài lại khi boot.

### Phase 1 — Tự nhận diện & chuẩn bị companion repos (~1 ngày)

| # | File | Thay đổi |
|---|---|---|
| 1.1 | `prisma/schema.prisma` + migration | `Run.companions Json @default("[]")` — `[{ name, path, cwd, baseSha }]`. `Run.companionPrUrls String[] @default([])`. `PlannedTicket.companionPrUrls String[] @default([])`. `npx prisma migrate dev` + `generate`. Không cần cột cấu hình trên `RootRepoProjectMap`. |
| 1.2 | `lib/repoContext.ts` (pure, mới) + `tests/repoContext.test.ts` | `companionPathsFromInstructions(text)`: trích đường dẫn tuyệt đối (Windows/POSIX) từ nội dung md. Pure → test nhanh. |
| 1.3 | `lib/preflight.ts` | `discoverCompanionRepos(rootRepo)`: đọc `CONTEXT_FILES` của root, áp 1.2, giữ path tồn tại + là git repo + khác root, bỏ trùng. Path md nhắc mà không hợp lệ → **warning** trong log (không chặn: có thể ticket không cần nó). System Check hiển thị danh sách tìm được cho từng Root repo. |
| 1.4 | UI | Không bắt buộc. Overview/Result chỉ **hiển thị** "Related repos (from CLAUDE.md)" để dev thấy run sẽ được phép chạm repo nào. |
| 1.5 | `lib/execution/runner.ts` — `startRun()` | Gọi 1.3 (áp dụng cho cả route và scheduler). Với mỗi companion: `excludeTeArtifacts`, `applyGitIdentity`; single-ticket mode: `returnToDefaultBranch` (fail trước spawn nếu tree bẩn); ghi `baseSha`; isolate: `git worktree add --detach <companion>/.te-worktrees/<project>-<runId>` + `carryRepoContext`. Lưu vào `live.ctx.companions`. |
| 1.6 | `lib/execution/graph/types.ts` | `RunContext.companions: { name; path; cwd; baseSha }[]`. |
| 1.7 | `lib/execution/graph/persist.ts`, `runner.ts` — `rehydrate()` | Persist/khôi phục `companions`, `companionPrUrls`. |
| 1.8 | `lib/execution/graph/drive.ts` — `removeWorktree`, `clearRunArtifacts` | Lặp qua companion: remove worktree của nó (không bao giờ đụng `path` gốc). |

Admission: single-ticket mode đã chỉ cho 1 run toàn máy → sửa thẳng checkout companion là an toàn; multi-ticket mode dùng worktree riêng → không cần rule admission mới.

### Phase 2 — Implement / check / evaluate thấy mọi repo (~1 ngày)

| # | File | Thay đổi |
|---|---|---|
| 2.1 | `lib/execution/graph/prompts.ts` — `openingPrompt`, `evaluatePrompt` | Nối ` - Repos: <name>=<cwd>@<baseSha>; ...` khi có companion. `fixPrompt` không cần (resume giữ transcript). |
| 2.2 | `lib/execution/graph/graphs.ts` — helper mới `changedRepos(c)` | Trả về `[{ name, cwd, baseSha, files }]` cho root + companion có `git rev-list base..HEAD` khác rỗng. Pure-git, zero token. |
| 2.3 | `graphs.ts` — node `check` | Chạy `testGap` **cho từng repo đã thay đổi**; blocker ghi rõ repo (`file: "<repo>/"`). Không repo nào có commit → blocker như hôm nay. |
| 2.4 | `graphs.ts` — `committedLocally` | `committed` của agent vẫn là điều kiện; thêm đối chiếu: agent báo committed nhưng harness không thấy commit ở repo nào → FAIL "nothing was committed". |
| 2.5 | `skills/implement-ticket-v4/SKILL.md` | Mục mới **Repos**: nếu `Repos:` có mặt, đó là các repo được phép sửa (làm việc trong `cwd` harness đưa, không phải path gốc); agent tự quyết repo nào ticket cần; đọc `CLAUDE.md`/`AGENTS.md` của repo nào mình sửa; tạo **cùng tên branch** trong mỗi repo sửa (từ HEAD hiện tại, không `checkout main`); commit riêng từng repo; `.te/plan.md` (ở root) có cột Repo trong bảng Changes. Repo cần sửa mà không nằm trong `Repos:` → `blocked` với tên repo (dev bổ sung path vào CLAUDE.md của Root repo rồi chạy lại). |
| 2.6 | `skills/review-changes-v4/SKILL.md` | Khi có `Repos:`: chạy `git diff --stat <base>...HEAD` trong từng repo; AC phải được đáp ứng bởi **tổng** các diff. |
| 2.7 | `lib/execution/graph/drive.ts` — `captureDiff` | Gộp file change của mọi repo, path tiền tố `<repo>/` để Result tab và dashboard (`filesTouched`, `linesAdded`) đúng. |

### Phase 3 — Publish & release nhiều PR (~1 ngày)

| # | File | Thay đổi |
|---|---|---|
| 3.1 | `lib/execution/graph/schemas.ts` — `PUBLISH_OUTPUT` | Thêm `prs: [{ repo, prUrl, pushed, isDraft, reusedExisting }]` cho companion; `prUrl`/`pushed`… giữ nghĩa cho root (rỗng/false khi root không đổi). Consumer: edge publish + 3.3. |
| 3.2 | `prompts.ts` — `publishPrompt` | Truyền danh sách repo đã thay đổi (từ `changedRepos(c)`) + branch; yêu cầu PR draft mỗi repo, mỗi PR link ticket, description mỗi PR nhắc PR kia ("companion PR"). `DRAFT_RULE` giữ nguyên. |
| 3.3 | `graphs.ts` — edge `publish` | Mọi repo trong `changedRepos(c)` phải có PR `pushed` trong output (root qua `prUrl`, companion qua `prs[]`); thiếu → FAIL "<repo> was not pushed". |
| 3.4 | `drive.ts` (chỗ `live.prUrl = data.prUrl`) | `live.prUrl` = PR root, hoặc PR companion đầu tiên nếu root không đổi; `live.companionPrUrls` = phần còn lại. Ghi `TicketPullRequest` cho PR chính như hôm nay. |
| 3.5 | `lib/execution/planStore.ts` / chỗ copy `prUrl` sang `PlannedTicket` | Copy thêm `companionPrUrls`. |
| 3.6 | `lib/execution/release.ts` — `releasePlannedTicket` | Lặp `publishPullRequest` / `addPullRequestReviewers` qua `[prUrl, ...companionPrUrls]`; `prPublished`/`reviewersSet` chỉ true khi **tất cả** xong (vẫn retry an toàn vì mỗi write đọc lại state hiện tại). |
| 3.7 | `skills/implement-ticket-v4/SKILL.md` — Phase publish | Lặp push + check PR tồn tại + mở draft cho từng repo trong danh sách; idempotent như hiện tại. |
| 3.8 | Result tab (`app/ticket-executor/*`) | Hiện thêm link companion PRs. |

### Phase 4 — Kiểm thử
- `npm run test`: edge publish (thiếu PR companion → FAIL), check per-repo, AC partial, `changedRepos` (repo tạm bằng `git init` trong `tmpdir`), release với 2 PR.
- `npx tsc --noEmit`.
- E2E: không cấu hình gì thêm — `RIS/CLAUDE.md` đã nhắc ReportingService và RFI; chạy lại #25691 trên branch mới (hoặc ticket nhỏ 2 repo). Kỳ vọng: 2 draft PR, cùng branch name, `acceptanceCriteria: met`, Result tab hiện cả hai; thử cả single-ticket và multi-ticket mode (worktree companion được dọn sau run).
- Kiểm tra UI Related repos ở 390 × 844.

---

## 4. Rủi ro
| Rủi ro | Giảm thiểu |
|---|---|
| Agent sửa repo không có trong md (vẫn có quyền `--dangerously-skip-permissions`) | Skill cấm + harness chỉ publish repo trong danh sách; cảnh báo khi `git status` của path gốc companion bẩn sau run. |
| md nhắc path chỉ để tham khảo (vd. RFI) | Vô hại: worktree được tạo nhưng không commit → không PR, dọn khi run kết thúc. |
| `CLAUDE.md` của root untracked → máy khác không có | Đúng chủ đích: md local là cấu hình của chính dev trên máy đó; không có thì run chạy 1 repo như hiện nay. |
| Worktree companion sót lại khi crash | `recoverInterruptedRuns()` / `removeWorktree` dọn theo `Run.companions`. |
| Một PR publish được, PR kia lỗi | Edge publish FAIL rõ repo nào; publish idempotent (`reusedExisting`) nên chạy lại an toàn. |
| Release publish lệch (1 PR ready, 1 PR draft) | `prPublished` chỉ true khi đủ; tick sau retry phần thiếu. |
| Chi phí token tăng (đọc 2 repo) | Chỉ khi ticket thật sự cần; reviewer vẫn bắt đầu từ `--stat`. |

## 5. Thứ tự đề xuất
Phase 0 → merge riêng (giá trị ngay, rủi ro thấp) → Phase 1+2+3 trong một PR (các phần phụ thuộc nhau) → Phase 4 E2E với #25691.
