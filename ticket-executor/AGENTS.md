<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Which `CLAUDE.md` sections to read

Always: **What this app is**, **Two engines — keep them apart**, **Commands**, **Where code lives**.
Then only the sections for what you touch:

| Touching | Read in `CLAUDE.md` |
|---|---|
| `lib/execution/`, `lib/executionStore.ts`, `skills/`, `resolveSkill()` | Engine invariants — Ticket Execution |
| `lib/dagent/`, `lib/workflow/`, `agents/`, `lib/agentPack.ts`, `app/(app)/workflow`, `app/api/dagent/*` | D-Agent workflow engine |
| Flow Runner, My Sprint, `triage` / `planStore` / `release` / `scheduler`, `lib/sprintPlan.ts`, `lib/sprintClaim.ts` | Sprint plan and automation (+ the junction in Two engines) |
| `lib/providerCredentials.ts`, `lib/identity.ts`, `lib/mcp.ts`, `lib/crypto.ts` | Credentials — one source, no fallbacks |
| `lib/tickets.ts`, `lib/ado.ts`, `lib/github.ts`, any provider call | Multi-provider support; Redis cache on every load |
| New GET route, DB/provider read, or write path | Redis cache on every load |
| Client components, `app/queries.ts`, `app/useLive.ts`, `lib/liveStream.ts` | Data fetching and live state |
| Anything under `app/` (UI, CSS, layout) | UI changes; Mobile first (then `UI-STYLEGUIDE.md` + `lib/ui.ts`) |
| `lib/notifications.ts`, `lib/notificationSources.ts`, `lib/push*.ts`, `public/sw.js` | The notification bell |
| `lib/preflight.ts`, `instrumentation.ts`, `lib/terminal.ts`, `lib/ask.ts`, Dashboard metrics | Conventions that bite |
| `schema.prisma`, migrations | Commands (migrate + generate rule) |

A task about one engine reads that engine's section only — never the other's.
