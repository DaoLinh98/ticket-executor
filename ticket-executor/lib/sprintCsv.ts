// The plan as a CSV a spreadsheet opens. Pure: the page supplies the rows and the spend, and saves the text.

export type CsvRow = {
  ticketId: string;
  title: string;
  project: string;
  points: number;
  estimateHours: number;
  implementOrder: number;
  releaseDay: string;
  implementState: string;
  reviewState: string;
  claim: string;
  prUrl: string;
};

const HEAD = ["Ticket", "Title", "Project", "Points", "Hours", "Queue", "Release day", "Run", "Review", "Claim", "Pull request", "Spent USD"];

// A cell that could be read as a formula is prefixed so a spreadsheet shows it as text.
function cell(v: string | number): string {
  const s = String(v);
  const safe = /^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s) ? "'" + s : s;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export function planCsv(rows: CsvRow[], costs: Record<string, number>): string {
  const lines = rows.map((t) =>
    [t.ticketId, t.title, t.project, t.points, t.estimateHours, t.implementOrder || "", t.releaseDay, t.implementState, t.reviewState, t.claim, t.prUrl, (costs[t.ticketId] ?? 0).toFixed(2)].map(cell).join(",")
  );
  return [HEAD.map(cell).join(","), ...lines].join("\r\n") + "\r\n";
}
