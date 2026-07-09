Please read the following Client Brief then give the app design
note: The application features a modern, distinctive, and creative interface with smooth animations.

# Client Brief: Minimal AI Ticket Executor

## 1. Project Overview

Build a lightweight personal web application that allows a developer to view Azure DevOps tickets and execute a selected ticket through Claude Code CLI directly from the UI.

The first version should focus only on the core workflow:

**List tickets → Select ticket → Click Implement → Run Claude CLI local → Show result on UI**

The goal is not to build a full developer management system at the beginning. The goal is to validate that the app can successfully trigger Claude CLI for a ticket and return the execution result back to the user interface.

---

## 2. Current Manual Workflow

Currently, the developer works on a ticket manually by:

1. Opening Azure DevOps.
2. Going to the current sprint.
3. Opening a ticket and reviewing its description and Acceptance Criteria.
4. Opening Claude Code CLI in the project root folder.
5. Typing a command such as:

```text
/implement-ticket <ticketId>
```

6. Claude uses the connected ADO MCP to read the ticket information.
7. Claude implements the ticket.
8. Claude returns a text summary explaining what was done, what was changed, and what was verified.

---

## 3. Target Workflow in the App

The application should simplify the manual workflow into a UI-based flow.

Target user flow:

1. User opens the web app.
2. User sees a list of tickets from the current sprint.
3. User selects one ticket.
4. User clicks **Implement Ticket**.
5. The backend runs Claude Code CLI with the correct skill name and ticket ID.
6. Claude completes the implementation.
7. The backend captures Claude’s final output.
8. The UI shows the execution status.
9. User clicks **Show Result** to view what Claude completed.

---

## 4. MVP Scope

The MVP should include only the following features:

### 1. Ticket List

Display tickets from Azure DevOps sprint.

Each ticket item should show:

- Ticket ID
- Title
- Status
- Assigned user
- Ticket type
- Implement button

The list can be simple. Advanced filters, dashboards, reports, and analytics are not required for MVP.

---

### 2. Implement Ticket Action

Each ticket should have an **Implement Ticket** button.

When clicked, the app should send the ticket ID to the backend.

Example input:

```json
{
  "ticketId": "12345",
  "skillName": "implement-ticket",
  "projectName": "fee-center"
}
```

The backend should convert this into a Claude CLI command.

Example command behavior:

```text
/implement-ticket ID: 12345 - Project name: fee-center
```

The command should run inside the correct local project root folder.

---

### 3. Claude CLI Execution

When the user clicks "Implement" on a ticket, the backend starts a local Claude CLI subprocess with the selected ticket ID and command/skill name ID ticket: - Project name: . The backend captures the CLI output stream and returns the final execution summary to the UI.

Ex: powershell.exe -NoExit -Command claude -p hello
maybe if you have anyway for m better this is just suggestion

Responsibilities:

- Receive ticket ID from UI.
- Resolve the project root folder.
- Build the Claude command.
- Run Claude CLI.
- PR creation
- PR description generator
- Commit creation
- Branch creation
- Wait for Claude to finish.
- Capture the text output.
- Save the result.
- Return execution status to UI.

Possible statuses:

- Not started
- Running
- Completed
- Failed

---

### 4. Execution Result UI

After Claude finishes, the user should be able to click **Show Result** (text output of cli look like md file).

The result page/modal should show Claude’s returned text, including:

- Summary of what was implemented
- Changed files
- Verification result
- Test commands
- Notes or risks
- Next suggested action

For MVP, the app does not need to parse the result into complex sections. Showing the raw Claude output is acceptable.

---

## 5. Out of Scope for MVP

The following features should not be included in the first version:

- Git diff review
- Advanced checklist
- Daily update generator
- Knowledge base
- AI risk analysis
- Multi-user support
- Full dashboard analytics
- Complex ticket planning workflow

These can be added later after the main execution flow works reliably.

---

## 6. Recommended MVP Architecture

### Frontend

Main responsibilities:

- Show ticket list.
- Allow user to click **Implement Ticket**.
- Show execution status.
- Show Claude result.

Suggested pages:

1. **Tickets Page**
   - Displays sprint tickets.
   - Provides Implement button.

2. **Execution Result Modal/Page**
   - Shows Claude output after execution.

---

### Backend / Local Agent

Main responsibilities:

- Connect to ADO or receive ticket list data by API key of ADO which ís full access.
- Excute Claude CLI.
- Capture output.
- Store execution result.

Suggested APIs:

```text
GET /api/tickets
```

Returns sprint tickets.

```text
POST /api/tickets/{ticketId}/implement
```

Starts Claude CLI execution for the selected ticket.

```text
GET /api/executions/{executionId}
```

Returns execution status and Claude result.

---

## 7. Basic Data Model

### Ticket

```text
id
adoTicketId
title
status
type
assignedTo
projectId
```

### Project

```text
id
name
defaultSkillName
```

### Execution

```text
id
ticketId
projectId
skillName
status
command
resultText
startedAt
completedAt
errorMessage
```

---

## 8. Success Criteria

The MVP is considered successful when:

1. The app can display tickets from the current sprint.
2. The user can click **Implement Ticket** on a ticket.
3. The backend can run Claude CLI with the correct ticket ID.
4. Claude can complete the ticket workflow.
5. The app can capture Claude’s text output.
6. The user can view the result from the UI.

---

## 9. Development Priority

Build in this order:

1. Static/manual ticket list first.
2. Implement button.
3. Backend command execution.
4. Claude CLI integration.
5. Execution status tracking.
6. Show result UI.
7. Connect real ADO ticket list after the core flow works.

---

## 10. Final MVP Goal

The first version should prove only one thing:

**A developer can select a ticket from the web UI, click Implement, let Claude Code CLI execute the ticket, and view the final Claude result back on the UI.**

After this flow works reliably, the application can be expanded with PR creation, Git review, checklist, prompt templates, and reporting features.
