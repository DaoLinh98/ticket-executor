---
name: triage-sprint-v1
description: Review one developer's tickets in one sprint for readiness, estimate accuracy and work order, and return the result as structured data
---

Review the sprint tickets named in $ARGUMENTS: decide whether each one is ready to
be worked on, whether its estimate matches the real scope, what order they should
be picked up in, and which of them a business analyst has to answer something
about before work starts.

## Read only

This skill **never writes anything**. Do not post a comment on a work item, do
not change a story point value, do not change a state, do not create a branch and
do not touch a file in the repository.

Increasing an estimate and asking a client a question both have consequences the
developer owns. Your job is to draft those, not to send them. The application
shows your answer to the developer, who applies the parts they accept.

## What you are given

`$ARGUMENTS` carries the provider, the organization URL, the project, the sprint
name, the developer's account in that organization, and the work item ids to
review, each with its type, state, size, area path and link. Review exactly those
ids — do not widen the query to the rest of the team's sprint.

`$ARGUMENTS` also carries a `Repository:` line, which is the only statement about
the checkout you should trust. Read it before you plan the turn.

## Where the two halves of the answer come from

Ticket content — title, description, criteria, comments, attachments, links —
comes from the provider's MCP server. One server is configured for this turn and
it is the one for the organization named in `$ARGUMENTS`. Everything you know
about a work item comes from there, never from the file system.

The repository is the second half, and it is what the `Repository:` line
resolves:

- **A path is named.** That path is the current working directory and it is this
  project's root repo. Read it there. Do not clone anything, do not go looking
  for another copy on the machine, and do not ask for one.
- **None is available.** Judge from the work items alone. Say so once in
  `summary`, and where a ticket's verdict actually turned on code you could not
  read, say that in its `reason`. This does **not** lower a ticket's readiness on
  its own — see below.

A sprint's work is not always in one repository. When a ticket's area path points
somewhere the checkout plainly does not cover, treat it exactly as the second
case above: judge it from the work item, note the limit in `reason`, and move on.

**Never** mark a ticket `needs-clarification` or `blocked`, and never set
`needsClarification`, because you could not read code. Those flags mean a person
has to answer something, and they stop the scheduler from running the ticket at
all. Missing code is your limitation to report, not a question for the client.

## What to collect

For each ticket: title, description, acceptance criteria, current story points or
effort, discussion comments, attachments, and any linked or dependent work items.

Then, when a repository is available, do a real pass over it rather than a
glance. Start with `CLAUDE.md`, `.claude/CLAUDE.md`, `README.md` and any
architecture notes they point at, then, for each ticket, find the code the change
would actually land in: search for the screen, endpoint, service, entity, job or
report the ticket names, open what you find, and follow it far enough to see the
shape of the change — the layers it crosses, the shared code it touches, whether a
migration is involved, and what already handles the case the ticket describes.

That pass is what separates a requirement that is genuinely ambiguous from one the
codebase already answers, and it is the only honest basis for a sizing verdict.
Record what you actually read in `evidence` — the concrete paths and symbols, not
"reviewed the codebase". A verdict with no evidence behind it is a guess, and the
developer needs to be able to tell the two apart.

## Readiness

A ticket is **ready** when the expected behaviour is clear, the acceptance
criteria are testable, the target page/API/service/workflow can be identified, the
change fits an existing structure, there is no contradiction between description,
criteria and comments, its dependencies exist, and the developer can implement and
verify it without guessing business intent.

A ticket **needs clarification** when the expected behaviour is ambiguous, the
criteria contradict the description or comments, a required data source, API,
role, permission or environment is unclear, it references a missing document or
screenshot, it conflicts with an existing workflow, the verification expectation
is unclear, or there is a real risk of building the wrong behaviour.

A ticket is **ready-with-notes** when nothing is missing — it can be started
today, and nobody has to answer anything first — but there is something the
developer should carry into the work: a shared component the change will touch, an
edge case the criteria do not name, an existing convention that dictates the
approach, a regression worth watching. The notes are context, never a
prerequisite. If something genuinely has to be answered before work starts, the
ticket is `needs-clarification`, not `ready-with-notes`.

Do not mark a ticket unclear only because an implementation detail is
unspecified. Infer those from the codebase when it is safe to do so.

Use `blocked` only when work cannot start at all — a hard dependency that does not
exist yet, or a contradiction nobody but the client can resolve.

## Estimation

Take the existing estimate as the baseline. Suggest raising it only on strong
evidence: the change spans several modules or workflows, needs both UI and
backend work, changes database logic, carries many branching rules or edge cases,
depends on unclear requirements, plainly excludes testing and regression effort,
requires investigation before implementation can begin, or touches shared
services, reports, background jobs, permissions or financially sensitive logic.

Do not raise it when the scope is clear and limited, the work follows an existing
pattern, the change is mostly configuration, text, layout, mapping or small
validation, or the uncertainty is minor and resolvable while implementing.

Raising an estimate affects how the client reads the team. When you do suggest
one, the reason must be specific enough to paste into a work item comment.

## Work order

Order the tickets the way a developer should actually pick them up, `1` first:

- A ticket another ticket depends on comes before it. Record that in `dependsOn`.
- A ticket that is ready comes before one still waiting on an answer.
- Among equals, prefer the one that unblocks the most other work, then the
  smaller one — finishing something early gives the reviewer work to do while the
  larger ticket is still in progress.

Every reviewed ticket gets a distinct `workOrder`, including blocked ones: the
developer needs to know where a ticket would sit once its answer arrives.

## Output

Return the structured object your output contract defines. Do not answer with a
table, a report, or prose outside it — the application renders the tables from
your data, and anything you write outside the contract is discarded.

Every field is required for every ticket:

- `id` — the work item id, exactly as you were given it.
- `title` — the work item title, so the report reads on its own.
- `readiness` — `ready` | `ready-with-notes` | `needs-clarification` | `blocked`.
- `needsClarification` — true when a person has to answer something before work
  starts. This is the flag that stops the scheduler from running the ticket
  automatically, so set it only when you mean it.
- `currentPoints` — the estimate the ticket carries now; `0` when unsized.
- `suggestedPoints` — what it should be. Equal to `currentPoints` when you are
  not proposing a change.
- `estimateVerdict` — `reasonable` | `increase` | `high` | `cannot-evaluate`.
- `estimateReason` — why, in one or two sentences, naming the scope that drives
  it. Required even when the verdict is `reasonable`.
- `risk` — `low` | `medium` | `high`: how likely this ticket is to go wrong or
  overrun once started, given what the code and the requirement actually look
  like.
- `workOrder` — 1-based position in the pick-up order.
- `dependsOn` — work item ids this one must follow. Empty when none.
- `reason` — one or two sentences on the readiness verdict, specific to this
  ticket.
- `blockers` — the specific things standing between this ticket and `ready`, one
  per entry, each naming what is missing and who can supply it. **Empty for a
  `ready` ticket**, and for a `ready-with-notes` one — a ticket nobody has to
  answer anything about has no blockers, only notes carried in `actions`. Never
  list "could not read the code" here.
- `actions` — what the developer does next, in order, as short imperative steps
  ("Add the N/A option to the RFI answer enum and migrate existing rows",
  "Ask the BA which value Yield to Maturity should fall back to"). Never empty:
  a blocked ticket's first action is chasing the answer that unblocks it, and a
  ready ticket's actions are the implementation outline. Between two and five
  entries — this is the part the developer works from.
- `questions` — the questions a person has to answer, one per entry, phrased so
  they can be asked as they stand. Empty when none, and non-empty exactly when
  `needsClarification` is true.
- `evidence` — what in the checkout the verdict rests on: concrete paths, and the
  symbol or convention each one supplied. Empty only when no repository was
  available.
- `clientCommentDraft` — an English comment ready to paste into the tracker, or
  an empty string when no comment is warranted. Most tickets should have an empty
  one.

`summary` is two or three sentences for the developer: how many are ready, how
many need an answer, and anything about the sprint as a whole worth knowing
before starting.

`finalNotes` is what applies to the sprint rather than to one ticket —
assumptions you made, context you could not reach, a sequencing risk across
tickets, a deadline someone mentioned in a comment. One item per note, and an
empty array when there is nothing worth saying.
