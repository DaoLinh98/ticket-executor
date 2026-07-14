export type Ticket = {
  id: string; // ADO work item id (string)
  title: string;
  type: string; // User Story | Bug | Task | Feature | ...
  status: string; // ADO state, e.g. "In Progress"
  assignee: string;
  project: string; // last segment of area path, or default project
  areaPath: string;
  description: string; // plain text
  criteria: string[]; // acceptance criteria, one line each
};

export type TicketComment = {
  author: string;
  date: string; // short human date, e.g. "Jul 2"
  text: string; // plain text (may contain @mentions and newlines)
};

export type ExecStatus = "not started" | "running" | "completed" | "failed";

export type LogLine = { text: string; kind: string };

export type Execution = {
  id: string;
  adoTicketId: string;
  projectName: string;
  skillName: string;
  status: ExecStatus;
  command: string;
  logLines: LogLine[];
  resultText: string;
  errorMessage: string;
  startedAt: string;
  completedAt: string | null;
};
