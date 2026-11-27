# D-Agent Workflow — chi tiết từng node (tiếng Việt)

Tài liệu mô tả trang `/workflow` và engine D-Agent đứng sau nó. Mọi thông tin lấy trực tiếp từ code:
`lib/dagent/{graph,engine,checks,rules,prompts,schemas,cli,stepModels,retryPolicy,view}.ts`,
`lib/workflow/{present,types}.ts`, `app/ticket-executor/workflow/*`.

> Quy ước: **harness** = phần code TypeScript của app (không phải LLM) bao quanh các agent: chuẩn bị git, đọc ticket,
> dựng brief, kiểm tra kết quả, quyết định route. **Agent** = một lượt `claude -p` chạy một subagent trong `agents/<tên>.md`.
> **Check** = node thuần harness, không tốn token.

---

## 1. Tổng quan

### 1.1 Ba loại node

| Loại | Ai chạy | Token | Ví dụ |
|---|---|---|---|
| `harness` | Code trong `checks.ts` (git, đọc file) | 0 | `setup`, `syncBase` |
| `check` | Hàm kiểm tra trong `checks.ts` / `rules.ts` | 0 | `planCheck`, `diffGuard`, `prePublish`, `verifyPublish` |
| `agent` | `claude -p --agent <tên>` qua `cli.ts` | Có | `readiness`, `plan`, `implement`, `evaluate`, `fix`, `reflect`, `publish`, `recap` |

Mỗi node có `effects`: `pure` (chỉ đọc), `local` (ghi vào worktree), `external` (đẩy ra ngoài — **chỉ `publish`/`respond`**).

### 1.2 Flow chính `dagent-implement-v4`

```
setup → readiness → plan ⇄ planCheck → implement → syncBase → diffGuard → evaluate → prePublish → publish → verifyPublish → END
                      │                                  ▲           │          │
                      │                                  │           ▼          ▼
                      │                                  └──────── fix ◄────────┘
                      │                                              │
                      │                                              ▼
                      │                                           reflect → FAIL
   (readiness → NEEDS_INPUT: park chờ PO; implement không đổi gì → NEEDS_REVIEW)
   (mọi kết thúc đều đi vòng qua `recap` trước khi dừng)
```

Hai flow phụ cùng engine: `dagent-fix-review-v2` (sửa theo review PR) và `dagent-fix-qa-v4` (sửa theo QA) — xem mục 4.

### 1.3 Cách harness gọi một agent (`engine.ts › execAgent`, `cli.ts › turnArgs`)

Mỗi node agent là **một tiến trình `claude` mới, ngữ cảnh trống (`context: "fresh"`)**. Brief là thứ duy nhất agent nhận.

Trình tự trong `execAgent`:

1. **MCP**: `resolveMcp` + `writeRunMcpConfig` ghi file cấu hình MCP riêng cho lượt này (chứa PAT, nằm ở `tmpdir()/te-mcp`, xóa sau lượt).
2. **Repo liên quan**: `companionDirs()` → `--add-dir` cho các repo companion nằm trong scope của plan.
3. **Tiền xử lý theo node** (xem từng node bên dưới): `readiness` đọc work item + `refreshBase` khi recheck; `readiness/qaTriage/reviewTriage` nạp `skillsOff()`.
4. **Dựng brief**: `node.prompt(ctx)` (hàm trong `prompts.ts`), lưu thành artifact `brief:<stepId>` → hiện trên trang là **"Context received"**.
5. **Chọn model**: `turnFor()` (`stepModels.ts`).
6. **Chạy** `runWithClaudeAccounts` — hết quota/token lỗi thì chạy lại lượt đó trên tài khoản Claude kế tiếp.
7. **Hậu xử lý theo node**: trộn dữ kiện harness vào output (`deliveryFacts`, `reviewedHeads`…), chạy `checkReadiness` / `checkReview` / `applySkills`.
8. Nếu agent không trả `structured_output` hợp lệ → **node fail** (run không bao giờ route trên văn bản tự do).

Cờ CLI cố định của mỗi lượt:

```
claude -p <brief> --agent <tên> --session-id <uuid> --output-format stream-json --verbose
  --dangerously-skip-permissions --disallowedTools Agent Skill(<DENIED_SKILLS>…)
  --json-schema <schema của node> [--add-dir <repo companion>…]
  --mcp-config <file riêng> --strict-mcp-config [--model …] [--effort …] + tắt plugin
```

Model theo node (`stepModels.ts`): Opus cho phán đoán (`readiness` medium, `plan` high, `evaluate` high, `qaTriage`), Sonnet cho khối lượng lớn (`implement`, `fix`, `reflect`, `reviewTriage`, `respond`, `recap` low), Haiku cho cơ học (`publish` low). `fix` **nâng lên Opus từ lần fix thứ 3** (`FIX_ESCALATES_AT`).

### 1.4 Harness còn làm gì ngoài các node (`engine.ts`)

| Chỗ | Việc harness làm |
|---|---|
| `startRun()` — admission | Preflight (root repo hợp lệ, agent truy cập được provider, `checkAgents()` đủ agent đúng version) rồi khóa advisory `ticket-executor:dagent-admission`: không có run đang chạy cho ticket, còn slot (`concurrentRuns`, mặc định 2). Kết quả là 2 "gate" `preflight`, `admission` hiện trên trang. |
| `drive()` — vòng lặp | Mở step, chạy node, ghi log, `closeStep`, gọi **edge** của node để quyết định node kế (chỉ route trên `structured_output` đã validate). Edge trả node không khai báo trong `next` → FAIL. `MAX_HOPS = 60` chặn vòng lặp. |
| `capturePlan()` | Sau `plan` (hoặc khi output có `planMd`): ghi `.te/plan.md` bằng `renderPlan()` (văn xuôi + bảng AC + risks + decisions) và lưu artifact `plan`. |
| `promote()` | Đẩy `ticketTitle` (từ readiness/qaTriage), `branch` (từ implement/fix), `prUrl` (từ publish) lên bản ghi run. |
| `recapWorth()` | Mọi kết thúc đi vòng qua `recap` (mục 3.16). |
| `park()` | `NEEDS_INPUT` → run `waiting`, giải phóng slot; tiếp tục bằng `resumeRun(..., "recheck-readiness")`. |
| `finish()` | Lưu diff `KNOWLEDGE.md` (artifact `knowledge`), gỡ **worktree + nhánh `te-run/<runId>`**, bắn sự kiện cho Flow Runner. |
| `reconcileOrphans()` | Run còn `running` mà tiến trình này không giữ → đánh `failed` ("Interrupted by a server restart"). |
| `retrySeed()` | Chạy lại từ `plan`/`implement`/`syncBase`: giữ lại kênh cũ, base, nhánh, plan (riêng retry từ `plan` thì bắt đầu mới từ base hôm nay). |
| `retryPolicy.ts` | `classifyFailure()` → `transient` (tự retry tối đa 2 lần) / `env` (tắt autoImplement) / `agent` (chờ dev). `retryNodeFor()` ánh xạ node lỗi → điểm retry. |

### 1.5 "Kênh" (channels) — cách node truyền dữ liệu cho nhau

Output của mỗi node được lưu vào `ctx.channels[<nodeId>]`. Brief của node sau **đọc từ kênh**, không có cách nào khác.
Ví dụ: `implement`/`fix`/`evaluate` đọc `channels.plan` (`planContract`); mọi role sau `readiness` đọc `digest` ở `channels.readiness`; `fix` lưu thêm `input` (các blocker nó nhận) để lần review sau so sánh (`stalledFix`).

---

## 2. Bảng tóm tắt các node (flow implement)

| Node | Loại | Chạy bởi | Model | Next |
|---|---|---|---|---|
| `setup` | harness | git | — | `readiness` / FAIL |
| `readiness` | agent | `analyst` | Opus · medium | `plan` / END / NEEDS_INPUT / FAIL |
| `plan` | agent | `planner` | Opus · high | `planCheck` / FAIL |
| `planCheck` | check | `planIssues()` | — | `implement` / `plan` / FAIL |
| `implement` | agent | `implementer` | Sonnet | `syncBase` / NEEDS_REVIEW / FAIL |
| `syncBase` | harness | git (async) | — | `diffGuard` / `fix` / FAIL |
| `diffGuard` | check | `diffViolations()` | — | `evaluate` / `prePublish` / `fix` / FAIL |
| `evaluate` | agent | `reviewer` | Opus · high | `prePublish` / `fix` / `reflect` / FAIL |
| `fix` | agent | `fixer` | Sonnet → Opus (lần ≥3) | `syncBase` / `reflect` / FAIL |
| `reflect` | agent | `reflector` | Sonnet | FAIL |
| `prePublish` | check | git | — | `publish` / `syncBase` / FAIL |
| `publish` | agent | `publisher` | Haiku · low | `verifyPublish` / FAIL |
| `verifyPublish` | check | git + provider | — | END / NEEDS_REVIEW |
| `recap` | agent | `recapper` | Sonnet · low | (kết thúc đã cất) |

---

## 3. Chi tiết từng node

### 3.1 `setup` — Chuẩn bị workspace (harness, `checks.ts › setup`)

**Mục đích**: tạo vùng làm việc cô lập cho run; không đụng vào clone của dev.

**Input**
- `ctx`: `ticketId`, `rootRepo`, `runId`, `flow`.
- `env`: `gitName`, `gitEmail` (từ Settings) và `retry` (seed khi chạy lại: `baseSha`, `branches`, `companionBases`, `planMd`, `fresh`).

**Harness làm**
1. `excludeRunFiles()`: thêm `/.te/`, `/.te-worktrees/`, `/KNOWLEDGE.md`, `/CLAUDE.local.md` vào `.git/info/exclude`.
2. `applyIdentity()`: đặt `user.name/email` của repo.
3. `startPoint()`: base = `origin/<nhánh mặc định>` vừa fetch. Fetch lỗi → bản fetch cuối (cảnh báo "may be behind"). Không có origin → HEAD local (cảnh báo). Không có gì → FAIL. **Không bao giờ** dùng HEAD local nếu có origin (có thể là nhánh feature của dev). Retry: dùng lại base của run cũ.
4. `git worktree add` tại `<repo>/.te-worktrees/dagent-<runId>` (detached tại base, hoặc nhánh cũ khi retry). Có `worktree prune` trước.
5. Retry: khôi phục `.te/plan.md` từ run trước.
6. `discoverCompanionRepos()`: tạo worktree cho mỗi repo liên quan song song. Retry qua plan: chỉ repo trong scope.
7. Retry **fresh** (từ `plan`): `seatBase()` lại nhánh base mà skill của readiness cũ yêu cầu.

**Output** (`NodeOutput.setup`): `branch`, `baseSha`, `repos[{name,path,base,from,branch}]`, `warnings[]` (hiện dạng danh sách cảnh báo trên trang).

**Route**: `readiness` / FAIL. Nếu run là retry vào `plan|implement|syncBase` thì `drive()` đổi đích sang `live.entry`.

> Flow review: `setupOnPrBranch` — fetch nhánh nguồn của PR, worktree `-B` trên đó; nếu nhánh đó đang checkout ở clone dev thì dùng nhánh cục bộ `te-run/<runId>` và push `HEAD:<nhánh PR>`. PR nằm ở repo companion thì checkout ở đó. Output thêm `localBranch`, `prRepo`, `scope`.

---

### 3.2 `readiness` — Ticket readiness (agent `analyst`, Opus/medium, `pure`)

**Mục đích**: quyết định ticket có làm được như viết không, rút AC, kiểm tra AC đã có sẵn trên base chưa, chọn skill.

**Input (brief, `readinessPrompt`)**
- **Context**: URL ticket, đường dẫn worktree + base commit, bản đồ repo liên quan, đường dẫn `KNOWLEDGE.md`. (Không có "Ticket" — chính role này viết digest.)
- **Work item**: do **harness đọc** trước (`readWorkItem()`: `loadTicket` + `loadTicketDetail` + `loadTicketComments` song song, `richToText` đổi HTML → text, cắt ở 16 000 ký tự). Đọc mỗi lần ghé, nên recheck thấy câu trả lời của PO. Đọc lỗi → brief dặn agent tự đọc qua MCP.
- **Previous readiness check** (chỉ khi recheck): câu hỏi đã hỏi, phần còn thiếu, `checkedAt` — để không hỏi lại điều PO đã trả lời.
- **Checking delivery**: quy tắc kiểm tra "AC đã giao" trên base (hoặc `origin/<baseBranch>` nếu chọn).
- **Your job** (5 việc) + **Skills menu** (`skillCatalog()` trừ `skillsOff`, mỗi skill tóm tắt bằng `skillSummary`, kèm `baseBranch` của skill nếu có).

**Harness trước lượt**: lần ghé thứ 2 trở đi → `refreshBase()` (đưa worktree còn sạch về base hôm nay).

**Output** (`READINESS_OUTPUT`): `title`, `type`, `digest{summary,details}`, `ready`, `acceptanceCriteria[]`, `missing[]`, `ambiguities[]`, `questions[]` (tối đa 3), `delivery{status none|partial|done, evidence[{ac,repo,proof}]}`, `codeLeads[{at,what}]` (≤8, chỉ cho planner), `skills[{name,reason}]`, `baseBranch`, `blocked`.

**Harness sau lượt**
- `checkReadiness()`: cắt câu hỏi còn 3 (phần dư chuyển vào `missing`); **hạ** `delivery` `done`→`partial|none` nếu không đủ proof cho từng AC (chỉ hạ, không bao giờ nâng). Ghi `checkedAt`.
- `applySkills()`: đổi tên skill → đường dẫn `SKILL.md` (skill không cài/đã tắt bị bỏ); nếu có `baseBranch` (hoặc skill đòi) → `seatBase()` chuyển mọi repo có `origin/<branch>` sang đó, ghi `bases`; không repo nào có = FAIL.

**Route** (`EDGES.readiness`):

| Điều kiện | Đích |
|---|---|
| `blocked.is` | FAIL |
| `!ready` và không có câu hỏi | FAIL ("nothing to wait for") |
| `!ready` | `NEEDS_INPUT` (park chờ PO) |
| `ready` nhưng 0 AC | FAIL |
| `delivery = done` | END (lưu artifact `delivery`) |
| còn lại | `plan` |

---

### 3.3 `plan` — Plan the change (agent `planner`, Opus/high, `local`, `maxVisits 2`)

**Input (`planPrompt`)**: Context (+ **Ticket** digest) · **Acceptance criteria** đánh số · **Already delivered** (khi `partial`) · **Code leads** (≤8 từ readiness) · **Settled by assumption** (`ambiguities` của readiness — phải ghi vào `decisions`) · **Previous plan refused** (danh sách issue + chính plan bị từ chối render lại) · Your job.

**Output** (`PLAN_OUTPUT`): `branch`, `acMap[{n,ac,change code|none,files,test}]` (mỗi AC đúng 1 dòng theo số `n`), `repos`, `risks`, `decisions[{point,decision,why}]`, `planMd` (chỉ văn xuôi, <50 dòng), `blocked`.

**Harness**: `capturePlan()` → ghi `.te/plan.md` = `renderPlan()` (văn xuôi + bảng AC→file→test + risks + decisions) và artifact `plan`. Agent **không được ghi file**.

**Route**: `planCheck` (hoặc FAIL nếu blocked).

---

### 3.4 `planCheck` — Plan check (check, `planIssues()`)

**Input**: `channels.readiness.acceptanceCriteria`, `channels.plan`, tên các repo của run, AC readiness đã chứng minh giao.

**Kiểm tra** (thuần quy tắc, 0 token): `planMd` không rỗng · có `branch` · mỗi AC được map **đúng 1 lần theo số** · dòng `code` phải nêu file · mỗi dòng có test/cách xác minh · không map `code` cho AC đã giao · mỗi decision nêu đủ `point` + `decision` · repo trong plan thuộc run.

**Output**: `passed`, `issues[]`, `checked{criteria,mapped,code,none,files,repos}` (hiện trên trang để pass không chỉ là "OK").

**Route**: pass → `implement`; fail và `visits.plan < 2` → `plan` (brief re-plan chứa plan bị từ chối để sửa đúng chỗ); hết lượt → FAIL.

---

### 3.5 `implement` — Implement (agent `implementer`, Sonnet, `local`)

**Input (`implementPrompt`)**: Context + Ticket digest · Acceptance criteria · **Approved plan** (`planContract`: bảng AC→file→test, repos, risks, decisions "build to these, do not reopen") · **Plan steps** (`planMd`) · Your job: tạo/dùng nhánh `plan.branch`; nếu skill yêu cầu base khác thì nhánh phải tạo từ HEAD hiện tại (harness đã checkout `origin/<base>`); **bắt buộc commit local, không push**; AC chỉ người xác nhận sau deploy → `manualChecks`; không cần đổi gì → giữ sạch, `committed:false`.

**Output** (`STEP_OUTPUT`): `committed`, `branch`, `summary`, `verification{tests,build,acceptanceCriteria}`, `deviations[{what,why}]`, `manualChecks[{n,check}]`, `blocked`.
Harness **trộn thêm** `deliveryFacts()`: `commitSha`, `filesChanged`, `uncommitted` (đếm bằng git thật, bỏ file scratch `.te/`).

**Route** (`implemented`): `blocked` → FAIL · có commit → `syncBase` · **sạch, 0 file, 0 uncommitted, không blocked → `NEEDS_REVIEW`** ("no code change needed", run kết thúc `succeeded`, gắn cờ cho dev) · còn lại FAIL ("nothing was committed").

---

### 3.6 `syncBase` — Sync with base (harness, git async)

**Input**: `ctx` (worktree các repo, `baseSha`), `basesOf()` (base theo skill nếu có).

**Harness làm**, cho từng repo đang **ở trên một nhánh** (repo detached bị bỏ qua):
1. `upstream()`: fetch `origin/<base skill hoặc nhánh mặc định>`, đếm `HEAD..origin/<base>` (số commit đang thiếu).
2. Nếu thiếu → `git rebase origin/<base>`.
   - **Conflict** → `git rebase --abort`, tạo **blocker** (kèm `evidence` + `expected`) gửi thẳng cho `fix` (reviewer chỉ đọc nên không giải quyết được).
   - Origin không với tới → **warning** "Not synced" cho reviewer.
3. Cập nhật base mới bằng `merge-base` để các bước sau diff đúng.

**Output**: `rebased`, `behindBy`, `conflicts[]`, `warnings[]`, `blockers[]`, `repos[{name,upstream,behind,status,base}]` (status: up to date / rebased / conflict / not synced).

**Route**: có blocker → `fix` (đã hết `MAX_FIX_ATTEMPTS = 5` lần fix → FAIL) · còn lại → `diffGuard`.

---

### 3.7 `diffGuard` — Diff guard (check, `diffGuard` + `diffViolations`)

**Input**: worktree từng repo, base, các file đã **plan** (`plannedFiles`: AC map `code` + QA defects + thread fix).

**Harness làm**, cho từng repo:
- Ghi `heads[repo]` = HEAD hiện tại; `diffHashes[repo]` = sha1 của **net diff** `base..HEAD` (bỏ `.te`).
- `changed` (file thật sự đổi, bỏ scratch), `unplanned` (đổi mà plan không nêu).
- Quét **từng commit** từ base (`git log -p`), không chỉ net diff: commit sau xóa secret thì commit đầu vẫn bị push.

**Quy tắc** (`rules.ts`):

| Rule | Loại | Hiệu lực |
|---|---|---|
| `no-agent-files` (CLAUDE.md, KNOWLEDGE.md, `.te/`, `.claude/`) | HARD | blocker → `fix` |
| `no-secret-files` (`.env`, `*.pem`, `id_rsa`…) | HARD | blocker → `fix` |
| `no-secrets-in-diff` (private key, AKIA, ghp_, xox, sk-, connection string có password…) | HARD | blocker → `fix` |
| `no-unplanned-config` (appsettings, web.config, docker-compose, pipelines…) | soft | warning → `evaluate` |

**Output**: `violations`, `warnings`, `blockers`, `changed[{repo,branch,files}]`, `heads`, `summary{changed,planned,unplanned}`, `diffHashes`.

**Route**: blocker → `fix` (hết 5 lần → FAIL) · `reviewStillHolds()` (review trước đã **pass**, không blocker, và **hash diff từng repo trùng** hash review đã duyệt = chỉ base di chuyển) → thẳng `prePublish`, bỏ review lại · còn lại → `evaluate`.

---

### 3.8 `evaluate` — Independent review (agent `reviewer`, Opus/high, `pure`)

**Input (`evaluatePrompt`)**: Context + Ticket · Acceptance criteria · Approved plan · **Harness warnings** (`syncBase.warnings` + `diffGuard.warnings` + cảnh báo từ báo cáo implement: test fail/not-run, build fail, AC partial) · **Implementer's/Fixer's account** (summary + deviations — chỉ là *lời khai để kiểm chứng*, không phải bằng chứng) · **Checked by a person after deploy** (`manualChecks`; reviewer không được chặn vì chúng, ghi `unverified`) · **Re-review** (từ lần 2: các blocker lần trước + lệnh `git diff <head đã duyệt>..HEAD`) · Your job (`git diff <base>..HEAD`, chỉ chạy test của module bị đụng).

**Output** (`EVALUATE_OUTPUT`): `verdict pass|changes-required`, `blockers[{file,issue,evidence,expected}]`, `checked[{subject,how,evidence,result ok|issue|unverified}]`, `assumptions[]`, `blocked`.

**Harness sau lượt**: ghi `reviewedHeads` + `reviewedDiffs` (lấy từ `diffGuard.heads/diffHashes`) cho lần re-review/bỏ-qua-review sau; `checkReview()` ghi `reviewNotes` ("pass nhưng không có evidence", "pass nhưng có check issue và không blocker", "changes-required nhưng không blocker") — **chỉ hiện badge "unproven", không đổi route**.

**Route** (`bundleOf` = blockers): 0 blocker → `prePublish` · `fix` đã đủ 5 → `reflect` · `stalledFix()` (cùng số blocker, cùng file, ≥50 % trùng từ so với blocker fix vừa nhận) → `reflect` ngay · còn lại → `fix`.

---

### 3.9 `fix` — Fix review blockers (agent `fixer`, Sonnet→Opus, `local`, `maxVisits 5`)

**Input (`fixPrompt`)**: Context + Ticket · Acceptance · Approved plan · **Blockers** — lấy qua `fixBlockersOf()` theo thứ tự ưu tiên: conflict rebase của `syncBase` → vi phạm HARD của `diffGuard` → blocker của reviewer · **Previous fix attempt** (từ lần 2: đã nhận gì, đã báo gì, bỏ lại gì) · Your job: sửa **đúng** các blocker, commit local, không push; blocker harness cần thao tác git trên commit chưa push của nhánh (rebase / viết lại commit để bỏ file) và **không chạm commit của base**.

**Output**: như `implement` (`STEP_OUTPUT`) + `deliveryFacts`; engine lưu thêm `input` (blocker đã giao) vào kênh `fix`.

**Route** (`fixed`): `blocked` → `reflect` · có commit → `syncBase` (lặp lại chuỗi `syncBase → diffGuard → evaluate`) · không commit → FAIL.

---

### 3.10 `reflect` — Record lesson (agent `reflector`, Sonnet, `local`)

**Input (`reflectPrompt`)**: lý do dừng (fixer bị blocked / không tiến triển / hết ngân sách) · blocker còn đứng · tóm tắt fix cuối · những gì fix cuối để nguyên · việc: có bài học tái sử dụng được thì ghi vào `KNOWLEDGE.md` của Root repo.

**Output** (`REFLECT_OUTPUT`): `recorded`, `lesson`.

**Route**: **luôn FAIL** (lý do cụ thể do edge `reflect` ghi: blocked / no progress / fix loop exhausted). `finish()` lưu diff `KNOWLEDGE.md` thành artifact `knowledge`.

---

### 3.11 `prePublish` — Pre-publish check (check, git)

**Input**: `diffGuard.changed` (repo + nhánh) và `diffGuard.heads` (HEAD đã được xác minh).

**Kiểm tra** từng repo có thay đổi: worktree sạch · commit nằm trên một nhánh · đúng nhánh `row.branch` · **HEAD không đổi** so với lúc `diffGuard` · (không phải flow review) origin chưa đi trước thêm (`baseMoved`). Không repo nào có commit → "nothing to publish".

**Output**: `passed`, `issues[]`, `baseMoved`.

**Route**: pass → `publish` · `baseMoved` và `visits.prePublish < 3` → `syncBase` · còn lại FAIL.

---

### 3.12 `publish` — Push & open draft PR (agent `publisher`, Haiku/low, `external`, `maxVisits 1`)

**Input (`publishPrompt`)**: Context (không có `KNOWLEDGE.md`) · **Repositories to publish** (`publishTargets`: repo, worktree, nhánh, base PR nhắm vào) · **Pull request description** do **harness dựng sẵn** bằng `prBody()` — agent dùng **nguyên văn**, không tự viết lại.

`prBody()` = Summary (summary của implement — những gì đã làm; không có thì lấy Goal của plan) · bảng AC (file thay đổi + kết quả review ok/issue/unverified) · Verification (tests/build, số check ok/issue/unverified). Không đưa Decisions, Manual checks, Not verified vào PR. Vượt giới hạn provider (**Azure DevOps 4000 ký tự**) thì tự rút gọn: cắt ngắn từng dòng → cắt theo dòng, kèm ghi chú nêu run id.

**Output** (`PUBLISH_OUTPUT`): `prs[{repo,branch,pushed,prUrl,isDraft,reusedExisting,linked}]`, `blocked`. `promote()` lưu `prUrl` của repo gốc lên run.

**Route**: mọi PR đều `pushed` và có `prUrl` → `verifyPublish`; không thì FAIL. Đây là **node `external` duy nhất của flow implement và không nằm trên vòng lặp**.

---

### 3.13 `verifyPublish` — Verify PR (check, git + provider)

**Input**: `channels.publish.prs`, worktree, `basesOf()`.

**Kiểm tra** (đọc lại, không tin báo cáo của publisher): `git ls-remote` — nhánh trên origin **bằng** HEAD đã xác minh · PR là draft · ticket đã link. Azure DevOps còn đọc lại tracker (`loadLinkedPullRequest`): ticket thấy PR đã link, PR draft, **PR nhắm đúng base** (base của skill, nếu không thì nhánh mặc định). Provider khác: chỉ cảnh báo, tin báo cáo của publisher.

**Output**: `passed`, `checks[{name,ok}]`.

**Route**: pass → END · lệch → `NEEDS_REVIEW` (run kết thúc `succeeded`, lý do "read-back mismatch" nằm trong transition; Flow Runner gắn cờ cho đến khi "Mark reviewed").

---

### 3.14 Kết thúc & park (terminal, không phải node)

| Terminal | Ý nghĩa | Trạng thái run |
|---|---|---|
| `END` | Xong | `succeeded` |
| `NEEDS_REVIEW` | Harness đã quyết (không có gì để đổi / read-back lệch) — cần người nhìn | `succeeded` (đi kèm cờ) |
| `NEEDS_INPUT` | Chờ PO trả lời câu hỏi | `waiting` → `recheck-readiness` |
| `FAIL` | Dừng không giao được | `failed` |

---

### 3.15 Gate trước run: `preflight`, `admission`

Không phải node trong graph nhưng hiện trên canvas khi chưa có run (`IDLE_DEFS`) hoặc khi bị từ chối: xem mục 1.4 (`startRun`). Lý do từ chối kèm `howTo` hiển thị trong `RefusalCard`.

---

### 3.16 `recap` — Recap the run (agent `recapper`, Sonnet/low, `pure`, `maxVisits 3`)

**Đặc biệt**: **không node nào khai báo `recap` trong `next`**. `drive()` chặn mọi lần chạm terminal và đi vòng qua `recap` nếu `recapWorth()` đúng (graph có node, chưa quá 3 lần, và một role phán đoán — `readiness/qaTriage/reviewTriage` — đã chạy; run chết ngay ở `setup` thì không recap).

**Input (`recapPrompt` + `runStory`)**: brief **toàn bộ từ kênh**: How it ended (terminal + lý do harness ghi, nhánh, PR) · Acceptance · Approved plan · What was built (summary, số file đổi/đã plan/ngoài plan, verification, deviations) · What the review proved (verdict, số vòng fix, bảng check) · Left open (assumptions, manual checks, blocker còn đứng, câu hỏi cho PO, bài học). Agent **chỉ có `StructuredOutput`** — không file, không git, không work item.

**Output** (`RECAP_OUTPUT`): `headline` + `headlineVi`, `sections[{key outcome|ask|work|review|watch|next, title/titleVi, bullets/bulletsVi}]` — **cả tiếng Anh lẫn tiếng Việt viết trong cùng một lượt**, lưu artifact `recap`; nút ENG/VIE trên trang chỉ đổi cách hiển thị, không gọi dịch.

**Route**: edge của `recap` **phát lại ending đã cất** (`ctx.outcome`) **bỏ qua kết quả của chính nó** — recap lỗi chỉ mất bản tóm tắt, không đổi kết cục. `currentNodeId` vẫn trỏ node làm nên kết cục để retry/failure panel chỉ đúng chỗ.

---

## 4. Hai flow phụ (cùng engine, dùng lại node)

### 4.1 `dagent-fix-review-v2` — sửa theo review PR

`setup (PR branch) → reviewTriage → implement → diffGuard ⇄ evaluate ⇄ fix → prePublish → respond → END`
**Không có `syncBase`** (nhánh PR đã publish, rebase cần force-push) — mọi chỗ `syncBase` được đổi thành `diffGuard` (`onPrBranch`).

| Node | Chạy bởi | Input | Output / việc |
|---|---|---|---|
| `reviewTriage` | `review-triager` (Sonnet) | Context (không Ticket), **Reviewer findings provided by developer** (`reviewFeedback` do app seed) + Your job + skills menu (không có base) | `threads[{threadId,file,comment,decision fix|reject|informational,reason}]`, `planMd`, `digest`, `skills`. Route: không có thread → FAIL; không thread nào cần sửa → thẳng `respond`; còn lại → `implement` |
| `implement` (đổi tên "Fix valid threads") | `implementer` | Acceptance = các thread `fix`; plan trong `.te/plan.md` | sửa trên nhánh PR, **không đổi nhánh, không rebase**, commit local |
| `prePublish` | check | như 3.11 nhưng bỏ kiểm tra base di chuyển | pass → `respond` |
| `respond` | `responder` (Sonnet, `external`, `maxVisits 1`) | Danh sách thread cần trả lời, thread thủ công (`manual-*`, `user-*`) | `git push origin HEAD:<nhánh PR>` (**không force**), mỗi thread một reply, **không bao giờ resolve thread**. Output `branch,pushed,replies[],threadsReplied,threadsResolved(=0)`. FAIL nếu có fix mà không push, hoặc không trả lời thread nào (trừ khi chỉ có thread thủ công) |

### 4.2 `dagent-fix-qa-v4` — sửa theo QA

`setup → qaTriage → implement → syncBase → diffGuard ⇄ evaluate ⇄ fix → prePublish → publish → verifyPublish → END`

| Node | Chạy bởi | Input | Output / route |
|---|---|---|---|
| `qaTriage` | `qa-triager` (Opus) | Context (không Ticket), **QC feedback to judge** (cửa sổ comment từ `followUp`: `since/upTo/triggers/developer`; comment của chính dev chỉ là ngữ cảnh), **Developer's decision** (ràng buộc: các finding dev duyệt sửa), skills menu (có `baseBranch`) | `findings[{finding,kind,defect,reason,files}]`, `outcome fix|no-fix-needed`, `branch`, `repos`, `planMd`, `qaReply` (trả lời cho QC), `summary`, `digest`, `skills`, `baseBranch`. Route: seed `followUp` chưa có `decision` → **END chỉ phân tích**; `no-fix-needed` → END kèm `qaReply`; `fix` mà không có defect/branch → FAIL; còn lại → `implement` |
| `implement` ("Fix QA defects") | `implementer` | Acceptance = các defect; `planMd` ghi vào `.te/plan.md` | thêm regression test cho mỗi defect, commit local |

---

## 5. Trang `/workflow` hiển thị node thế nào

- **Dữ liệu**: `fetchRunView(runId)` + SSE `/api/dagent/runs/<id>/stream` (`useLiveInvalidate`) → `lib/dagent/view.ts › outputOf()` chuẩn hóa output từng node thành `NodeOutput` → `lib/workflow/present.ts › outSections()` dựng các section hiển thị.
- **Input của node** trên trang = artifact **"Context received"** (`brief:<stepId>`, `BriefCard`) — chính xác là brief agent đã nhận. Node harness/check không có brief; "input" của chúng là các kênh đã ghi (mục 3).
- **Output của node** = tab Node của `NodeInspector` (verdict, bảng, danh sách, log, token/thời gian); tab Run = recap, plan, commit trên PR, so sánh với run trước, hướng dẫn retry.
- Chip skill từng node lấy từ `skillUse()` (`rules.ts`): đọc brief + log để phân loại skill `picked / read / unread / opened`.
- URL giữ `?run=&node=&tab=`; phím `j/k` đổi node, `f` bật/tắt follow; Cancel có hộp xác nhận kèm chi phí; Export tải JSON toàn bộ run view + log.
- Chỉ **run mới nhất của ticket** mới được Retry/Cancel (tránh đua với run thay thế).

---

## 6. Review code trang `/workflow` — phát hiện

> Đọc code, **chưa chạy trình duyệt** (trang yêu cầu đăng nhập; TODO cũng ghi mục WF6/WF7/mobile 390px chưa nhìn thật). Chưa sửa gì.

**Trạng thái xử lý (sau đợt sửa)** — kiểm chứng bằng `npx tsc --noEmit` và 90 test (`dagent`, `workflowLayout`, `workflowPresent`); **chưa kiểm tra trên trình duyệt**.

| Mục | Trạng thái |
|---|---|
| 1 `maxVisits` | Đã cưỡng chế trong `drive()` qua `overVisits()` (`graph.ts`), có test; các edge vẫn là chốt chính, đây là lớp dự phòng |
| 2 `exhausted` | **Không xóa**: là tương thích ngược với run cũ có step `skipped` (`present.ts` L1045, L1161). Chỉ thêm chú thích legacy |
| 3 `diffGuard passed` | Rút lại, không sửa |
| 4 `reviewedDelta` | Đã sửa: chỉ `true` khi `attempt > 1` **và** có `reviewedHeads`; có test |
| 5 `testGate` | Đã ghi chú legacy ở `types.ts`, `view.ts` |
| 6 phím tắt khi mở dialog | Đã sửa |
| 7 `RunCommits` nuốt lỗi | Đã sửa (thông báo + Retry/Dismiss) |
| 8 `readJson` | Rút lại, không sửa |
| 9 `?node=` không hợp lệ | Đã sửa: id không thuộc run → bỏ chọn và bật follow lại |
| MCP file khi agent ném lỗi | Đã sửa: `.finally()` quanh lượt agent (`engine.ts`) |

**Đã kiểm chứng, nên biết** (số thứ tự dưới đây là bản gốc lúc review; xem bảng trên để biết kết quả)
1. **`maxVisits` chỉ là metadata hiển thị.** Engine không chặn theo `maxVisits`; giới hạn thật nằm trong các edge (`planCheck` cho `plan`, `toFixer`/`evaluate` cho `fix`, `recapWorth` cho `recap`). `publish: maxVisits 1` chỉ an toàn vì node không nằm trên vòng lặp. Đề xuất: cưỡng chế một chỗ trong `drive()`, hoặc ghi rõ trong `types.ts`.
2. **Trạng thái `exhausted` của canvas là code chết.** `nodeStatus()` (`present.ts` ~L712) chỉ trả `exhausted` khi step cuối `skipped`, nhưng engine không bao giờ tạo step `skipped` (chỉ `lifecycleOf` ở `view.ts` dùng `skipped` cho stage). Chip "budget exhausted" thực tế không bao giờ hiện; tình huống hết ngân sách fix được thể hiện qua transition → `reflect`.
3. ~~`diffGuard` `passed = !violations.length` gây hiểu nhầm~~ — **đã rút lại**: `present.ts` L211-213 chủ ý dùng `passed=false` để hiện "n warning" khi chỉ có cảnh báo mềm và "n blocker → fix" khi có HARD. Không sửa.
4. **`reviewedDelta = attempt > 1`** (`view.ts` L232) chỉ là suy đoán. Thực tế re-review được quyết bởi `visits.evaluate > 1` + `reviewedHeads` có hay không; badge "delta since last review" có thể sai khi thiếu `reviewedHeads`.
5. **`testGate` còn nằm ở types/view/present/meta** dù graph hiện tại không có node này. Cần giữ vì run cũ (`engine.ts` L384 còn đọc `old.testGate?.results` khi retry), nhưng nên ghi chú "legacy".
6. **Phím tắt `j/k/f` chạy cả khi đang mở dialog** (hộp xác nhận Cancel, `CommitFilesModal`) — **đã sửa** trong `WorkflowView.tsx`: bỏ qua khi có `[role="dialog"][aria-modal="true"]` hoặc `.te-modal-overlay`, và khi giữ phím (`e.repeat`). `tsc` sạch; **chưa kiểm chứng trên trình duyệt**.
7. **`RunCommits` nuốt lỗi:** `filesQ.isError ? [] : …` hiển thị "không có file" khi thực ra lỗi mạng/provider — **đã sửa** trong `RunCommits.tsx`: lỗi hiện thông báo "Could not load the files of <sha>" kèm Retry / Dismiss. **Chưa kiểm chứng trên trình duyệt.** Card vẫn hiển thị mọi commit của PR mới nhất của ticket, không riêng của run (đúng với tiêu đề, chỉ dễ bị hiểu nhầm).
8. ~~`readJson`/`post` cục bộ là trùng lặp~~ — **đã rút lại**: hai hàm này chỉ còn phục vụ thao tác ghi (POST/PUT trong `useMutation`); mọi thao tác đọc đã dùng fetcher trong `app/queries.ts` đúng quy ước. Chỉ dòng W6 trong `TODO-sprint-workflow.md` ghi hơi lệch ("readJson" thực ra được thay bằng các fetcher riêng từng endpoint).
9. `?node=` trong URL không được validate (id lạ → `selected` rơi về `curId` nhưng `follow=false`) — vô hại nhưng người mở link sẽ không được follow node đang chạy.

**Không phải lỗi (đã loại trừ)**
- 3 lời gọi `useLiveInvalidate` cùng URL stream của run **không mở 3 kết nối**: `app/useLive.ts` dùng chung một `EventSource` cho mỗi URL.
- File cấu hình MCP chứa PAT không xóa nếu lượt agent ném lỗi trước `removeRunMcpConfig` (`engine.ts` L123): có `sweepStale()` dọn sau (`lib/mcp.ts`) nên chỉ là rủi ro thấp; vẫn nên bọc `try/finally`.

**Điểm tốt**
- Route chỉ dựa trên `structured_output` đã validate; harness tự kiểm chứng lại lời khai của agent (`checkReadiness`, `checkReview`, `verifyPublish` đọc lại từ origin/tracker, diff hash để bỏ review thừa).
- Brief là kênh truyền duy nhất, được lưu và hiển thị → debug "agent đã được bảo gì" rất rõ.
- Guard chạy **trước** khi spawn (admission, preflight, `checkAgents`), phù hợp ràng buộc "tốn tiền, đụng repo thật".
