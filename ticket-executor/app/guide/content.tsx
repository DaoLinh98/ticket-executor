"use client";

// The Guide page's content, kept out of page.tsx so the page stays pure layout.
// Each section maps 1-1 onto a System Check group where one exists, so the live
// badge on the section header is the same verdict the System Check page shows.

import type { ReactNode } from "react";
import type { CheckGroup } from "@/lib/preflight";
import { AccessDiagram, Bullets, Callout, Cmd, Code, DocsLink, P, Shot, SkillInstallerSlot } from "./parts";

// Mirrors REQUIRED_SKILLS in lib/preflight.ts. Not imported from there: that
// module is server-only (it reaches child_process through lib/mcp.ts), and a
// value import would pull it into the client bundle. Keep the two in sync.
const SKILLS = [
  "implement-ticket-v4",
  "fix-code-review-v4",
  "review-changes-v4",
] as const;

// What each one actually does. Every run commits locally, passes a test gate and
// an independent review (looping back to fix what they refuse), then publishes.
const SKILL_BLURB: Record<(typeof SKILLS)[number], string> = {
  "implement-ticket-v4": "builds the ticket, commits locally, and opens a draft PR once the test gate and the reviewer pass it.",
  "fix-code-review-v4": "works an existing PR's open review threads — fixes, then replies and resolves once the test gate and the reviewer pass the fixes.",
  "review-changes-v4": "the independent reviewer every run calls before publishing. Read-only; it never sees the implementer's reasoning.",
};

// Mirrors BUNDLED_AGENTS in lib/agentPack.ts (server-only, like REQUIRED_SKILLS).
const AGENTS = ["analyst", "planner", "implementer", "reviewer", "fixer", "reflector", "publisher"] as const;

const AGENT_BLURB: Record<(typeof AGENTS)[number], string> = {
  analyst: "readiness — reads the ticket, derives its acceptance criteria and checks what the base already delivers. Read-only.",
  planner: "writes the plan that maps every acceptance criterion to files and a test. Read-only.",
  implementer: "implements the plan and commits locally. Never pushes.",
  reviewer: "the independent review of the committed diff, in a fresh context. Read-only.",
  fixer: "fixes exactly the reviewer's blockers and commits locally.",
  reflector: "when the fix loop is exhausted, decides whether to record a lesson in KNOWLEDGE.md.",
  publisher: "pushes the verified branches and opens a draft PR linked to the ticket.",
};

export type GuideSection = {
  id: string;
  title: string;
  blurb: string;
  /** Which preflight group's checks drive this section's live badge. */
  checkGroup?: CheckGroup;
  docs: { label: string; href: string }[];
  body: ReactNode;
};

const CLAUDE_MD_TEMPLATE = `# CLAUDE.md

## Stack
- <framework + version>, <language>, <package manager>
- Tests: \`<test command>\`   Build: \`<build command>\`

## Where code lives
- \`src/features/<name>/\` — one folder per feature, UI + hooks + types together
- \`src/lib/\` — shared, framework-free helpers
- Put new code in the matching folder; do not create a new top-level folder.

## Conventions
- Match the style of the file you are editing.
- No new dependency without it already being in the manifest.
- Every new endpoint needs a test next to it.

## Do not
- Do not refactor code unrelated to the ticket.
- Do not rename or move existing files.
- Do not touch \`.env\`, CI config, or migrations unless the ticket says so.

## Verify before you finish
1. \`<test command>\` passes
2. \`<build command>\` passes
3. Only files related to the ticket appear in \`git status\`
`;

export const SECTIONS: GuideSection[] = [
  // 1 ----------------------------------------------------------------------
  {
    id: "cli",
    title: "Install & log in to the Claude CLI",
    blurb: "The app does not talk to Claude over an API — it spawns the CLI on your machine. No CLI, no runs.",
    checkGroup: "environment",
    docs: [
      { label: "Set up Claude Code", href: "https://docs.claude.com/en/docs/claude-code/setup" },
      { label: "Quickstart", href: "https://docs.claude.com/en/docs/claude-code/quickstart" },
    ],
    body: (
      <>
        <P>Node.js 18+ is required. Install the CLI globally, then log in once — the session is stored in your home directory and every run reuses it.</P>
        <Cmd label="INSTALL">{`npm install -g @anthropic-ai/claude-code`}</Cmd>
        <Cmd label="LOG IN — opens a browser, then pick your account">{`claude
/login`}</Cmd>
        <Cmd label="VERIFY — both must print a version">{`claude --version
git --version`}</Cmd>
        <Shot src="/guide/claude-login.png" caption="The CLI after a successful /login — the account line confirms the session." />
        <Callout tone="warning" title="Windows note">
          The CLI installs as a <Code>.cmd</Code> shim. If <Code>claude</Code> is not found from a new terminal, reopen the terminal so the updated <Code>PATH</Code> is picked up — the app spawns the CLI the same way your shell does.
        </Callout>
      </>
    ),
  },

  // 2 ----------------------------------------------------------------------
  {
    id: "skills",
    title: "Install the four skills",
    blurb: "A skill is the instruction set a run executes. This repo ships all four — install them onto your machine in one click.",
    checkGroup: "skills",
    docs: [{ label: "Agent Skills", href: "https://docs.claude.com/en/docs/claude-code/skills" }],
    body: (
      <>
        <P>
          Each skill is a single <Code>SKILL.md</Code> file in its own folder under <Code>~/.claude/skills/</Code> — the folder the Claude CLI reads. Which one a run uses is decided by the two Settings toggles, not chosen per ticket:
        </P>
        <Bullets
          items={SKILLS.map((s) => (
            <>
              <Code>{s}</Code> — {SKILL_BLURB[s]}
            </>
          ))}
        />
        <SkillInstallerSlot />
        <Callout tone="accent" title="This writes to your home directory">
          Installing copies the folders from this repo into <Code>~/.claude/skills/</Code>. Nothing is ever deleted, and a skill you have edited yourself is never overwritten without an explicit confirmation.
        </Callout>
        <P>
          You can also verify from a terminal: run <Code>claude</Code>, then <Code>/skills</Code>.
        </P>
      </>
    ),
  },

  // 2b ---------------------------------------------------------------------
  {
    id: "agents",
    title: "Install the D-Agent subagents",
    blurb: "The Workflow page runs each step as a subagent, not a skill. This repo ships all seven — install them onto your machine in one click.",
    checkGroup: "agents",
    docs: [{ label: "Subagents", href: "https://docs.claude.com/en/docs/claude-code/sub-agents" }],
    body: (
      <>
        <P>
          Each agent is a single <Code>{"<name>.md"}</Code> file under <Code>~/.claude/agents/</Code>, spawned by the D-Agent engine as <Code>{"claude -p --agent <name>"}</Code>. Only the Workflow page needs them; the skill-based Ticket Execution flow does not.
        </P>
        <Bullets
          items={AGENTS.map((a) => (
            <>
              <Code>{a}</Code> — {AGENT_BLURB[a]}
            </>
          ))}
        />
        <SkillInstallerSlot pack="agents" />
        <Callout tone="accent" title="Versioned like the skills">
          The app installs missing or older agents on start. A copy older than the one this repo ships is refused when a Workflow run starts, and one you have edited yourself is never overwritten without an explicit confirmation.
        </Callout>
        <P>
          You can also verify from a terminal: run <Code>claude</Code>, then <Code>/agents</Code>.
        </P>
      </>
    ),
  },

  // 3 ----------------------------------------------------------------------
  {
    id: "mcp",
    title: "Give Claude its own provider access (MCP)",
    blurb: "Separate from the app's connection. Without it, a skill cannot read the work item or open the PR.",
    checkGroup: "agent-access",
    docs: [
      { label: "MCP in Claude Code", href: "https://docs.claude.com/en/docs/claude-code/mcp" },
      { label: "What is MCP", href: "https://modelcontextprotocol.io/introduction" },
    ],
    body: (
      <>
        <AccessDiagram />
        <P>
          You have two options. <strong style={{ color: "inherit" }}>Managed</strong> — leave the <em>Manage MCP</em> toggle on in Settings and the app builds a temporary server config from your stored organization + token for each run, deleting it the moment the turn ends. <strong>Self-configured</strong> — register the server yourself and the app stays out of the way.
        </P>
        <Cmd label="SELF-CONFIGURED — register the Azure DevOps server once">{`claude mcp add azure-devops -- npx -y @azure-devops/mcp <your-organization>`}</Cmd>
        <Cmd label="CHECK IT — every server should say Connected">{`claude mcp list`}</Cmd>
        <Shot src="/guide/mcp-list.png" caption="`claude mcp list` — a Connected azure-devops entry is what the deep check looks for." />
        <Callout tone="warning" title="The organization is a positional argument">
          A server can silently point at a different organization than the one in Settings. If runs fail with &quot;work item not found&quot; while the connection test passes, compare the org in <Code>claude mcp list</Code> against the one on the Settings page.
        </Callout>
        <Callout tone="danger" title="Dead servers cost you 30+ seconds">
          Deep checks health-probe every registered server. An old connector that no longer authenticates will stall the probe. Remove what you do not use: <Code>claude mcp remove &lt;name&gt;</Code>.
        </Callout>
      </>
    ),
  },

  // 4 ----------------------------------------------------------------------
  {
    id: "connection",
    title: "Connect the app to your organization",
    blurb: "The organization-level credential this app uses to list projects, sprints and tickets.",
    checkGroup: "connection",
    docs: [{ label: "Azure DevOps PAT", href: "https://learn.microsoft.com/en-us/azure/devops/organizations/accounts/use-personal-access-tokens-to-authenticate" }],
    body: (
      <>
        <P>
          On the Settings page, enter the <strong>organization</strong> URL — not a project URL — and a personal access token. One connection serves every project in the org; you pick the project later, per run.
        </P>
        <Cmd label="ORGANIZATION URL — this shape">{`https://dev.azure.com/<your-organization>`}</Cmd>
        <Bullets
          items={[
            <>Minimum token scopes: <Code>Work Items (Read &amp; Write)</Code>, <Code>Code (Read &amp; Write)</Code>, <Code>Pull Request Threads (Read &amp; Write)</Code>.</>,
            <>Hit <strong>Test connection</strong> before leaving the page — it calls the provider for real.</>,
            <>The token is stored encrypted and is never sent back to the browser; the form only ever shows whether one exists.</>,
          ]}
        />
        <Shot src="/guide/ado-pat.png" caption="Creating the PAT in Azure DevOps — scope it, copy it once, it is not shown again." />
      </>
    ),
  },

  // 5 ----------------------------------------------------------------------
  {
    id: "context",
    title: "Give the agent context on your repo",
    blurb: "The single highest-leverage thing you can do. A run is only as good as what the repo tells it.",
    docs: [
      { label: "Memory & CLAUDE.md", href: "https://docs.claude.com/en/docs/claude-code/memory" },
      { label: "Best practices", href: "https://www.anthropic.com/engineering/claude-code-best-practices" },
    ],
    body: (
      <>
        <P>
          Drop a <Code>CLAUDE.md</Code> at the root of the repo you point runs at. It is read automatically at the start of every run and is the difference between a PR you merge and a PR you rewrite.
        </P>
        <Bullets
          items={[
            <><strong>Be specific about location.</strong> &quot;Put new API routes in <Code>src/api/</Code>&quot; beats &quot;follow the existing structure&quot;.</>,
            <><strong>Write the commands out.</strong> The exact test and build commands, copy-pasteable — otherwise the agent guesses and skips verification.</>,
            <><strong>Write the prohibitions down.</strong> &quot;Do not refactor unrelated code&quot; is the rule that most often saves a review cycle.</>,
            <><strong>Point at one good example.</strong> &quot;Model new endpoints on <Code>src/api/users.ts</Code>&quot; teaches more than a page of prose.</>,
            <><strong>Keep it short.</strong> A page that is read every run and stays current beats ten pages that drift.</>,
          ]}
        />
        <Cmd label="STARTER TEMPLATE — drop at the repo root, fill the placeholders">{CLAUDE_MD_TEMPLATE}</Cmd>
        <Callout tone="success" title="Nested files work">
          A <Code>CLAUDE.md</Code> inside a subfolder applies on top of the root one when the agent works in there — useful for a monorepo where each package has its own rules.
        </Callout>
      </>
    ),
  },

  // 6 ----------------------------------------------------------------------
  {
    id: "running",
    title: "Run a ticket well",
    blurb: "What the toggles actually change, and how to spend the fewest tokens getting a good PR.",
    docs: [],
    body: (
      <>
        <Bullets
          items={[
            <><strong>Set the Root repo per ticket.</strong> On the Overview tab. It is used verbatim as the working directory — the project name is never appended. It is remembered per project afterwards.</>,
            <><strong>Nobody approves a plan.</strong> The run writes one as a record (the Plan tab), then a test gate and an independent reviewer judge the finished diff and send it back to be fixed, at most twice, before anything is pushed.</>,
            <><strong>Keep a <Code>KNOWLEDGE.md</Code> in each project.</strong> Runs read it before coding and add the lessons that reviewers and QA had to teach them. It is never committed.</>,
            <><strong>Multi-ticket mode gives each run its own worktree.</strong> Leave it on to run tickets concurrently. Turn it off if you want to watch a single run in your own checkout — the app then refuses a second concurrent start.</>,
            <><strong>Run System Check before your first ticket of the day.</strong> Every blocker it lists is a run that would have failed after spending tokens.</>,
          ]}
        />
        <Callout tone="warning" title="Runs are real">
          A run commits, pushes and opens a pull request in the repo you point it at. There is no dry-run mode. Point your first run at a scratch repo.
        </Callout>
      </>
    ),
  },

  // 7 ----------------------------------------------------------------------
  {
    id: "troubleshooting",
    title: "Troubleshooting",
    blurb: "The failures that come up most often, and what actually fixes them.",
    docs: [{ label: "Claude Code troubleshooting", href: "https://docs.claude.com/en/docs/claude-code/troubleshooting" }],
    body: (
      <>
        <Bullets
          items={[
            <><strong>&quot;Skill not found&quot;</strong> — the folder name under <Code>~/.claude/skills/</Code> must match the skill name exactly, and the file inside must be named <Code>SKILL.md</Code>.</>,
            <><strong>Connection test passes but runs fail reading the ticket</strong> — that is the MCP lane, not the app lane. Go back to step 3.</>,
            <><strong>Run starts then dies immediately</strong> — usually a bad Root repo. It must exist, be a git repository, and have a pushable remote.</>,
            <><strong>Deep check takes ~30 seconds</strong> — expected. It health-probes every MCP server on the machine. Remove dead connectors to speed it up.</>,
            <><strong>A run is waiting on you after a restart</strong> — the server stopped while it was publishing, and nobody can tell whether the push landed. Check the branch and the PR, then cancel it.</>,
            <><strong>Nothing loads after a restart</strong> — parked runs survive restarts, live ones do not. Cancel and start again.</>,
          ]}
        />
      </>
    ),
  },
];
