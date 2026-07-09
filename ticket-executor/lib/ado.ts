import type { Ticket } from "./types";

const ORG = process.env.AZURE_DEVOPS_ORG ?? "";
const PROJECT = process.env.AZURE_DEVOPS_PROJECT ?? "";
const TEAM = process.env.AZURE_DEVOPS_TEAM ?? "";
const SPRINT = process.env.AZURE_DEVOPS_SPRINT ?? "";
const PAT = process.env.AZURE_DEVOPS_TOKEN ?? "";
const API = "api-version=7.0";

function authHeader(): Record<string, string> {
  const b64 = Buffer.from(":" + PAT).toString("base64");
  return { Authorization: "Basic " + b64 };
}

async function adoGet<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: authHeader(), cache: "no-store" });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`ADO ${res.status} ${res.statusText} — ${url}\n${body.slice(0, 300)}`);
  }
  return res.json() as Promise<T>;
}

/** Convert ADO rich-text (HTML) to readable plain text. */
function htmlToText(html: string): string {
  if (!html) return "";
  return html
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<\/\s*(p|div|li|tr|h[1-6])\s*>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Split acceptance-criteria HTML into individual lines. */
function htmlToLines(html: string): string[] {
  return htmlToText(html)
    .split("\n")
    .map((l) => l.replace(/^[-*•\d.)\s]+/, "").trim())
    .filter((l) => l.length > 0);
}

function lastAreaSegment(areaPath: string): string {
  if (!areaPath) return "";
  const parts = areaPath.split("\\");
  const last = parts[parts.length - 1].trim();
  // If the area is just the project root (no sub-area), treat it as no project.
  return last === PROJECT ? "" : last;
}

type Iteration = { id: string; name: string };

async function getIterationId(sprintName: string): Promise<string> {
  const url = `https://dev.azure.com/${ORG}/${encodeURIComponent(
    PROJECT
  )}/${encodeURIComponent(TEAM)}/_apis/work/teamsettings/iterations?${API}`;
  const data = await adoGet<{ value: Iteration[] }>(url);
  const found = data.value.find((i) => i.name === sprintName);
  if (!found) throw new Error(`Sprint "${sprintName}" not found among team iterations`);
  return found.id;
}

type WorkItemRelations = { workItemRelations: { target?: { id: number } }[] };

type WorkItemDetail = {
  id: number;
  fields: Record<string, unknown>;
};

/** Fetch all tickets in the configured sprint, mapped to the UI Ticket shape. */
export async function getSprintTickets(): Promise<Ticket[]> {
  const iterationId = await getIterationId(SPRINT);

  const wiUrl = `https://dev.azure.com/${ORG}/${encodeURIComponent(
    PROJECT
  )}/${encodeURIComponent(
    TEAM
  )}/_apis/work/teamsettings/iterations/${iterationId}/workitems?${API}`;
  const rel = await adoGet<WorkItemRelations>(wiUrl);
  const ids = Array.from(
    new Set(rel.workItemRelations.map((r) => r.target?.id).filter(Boolean) as number[])
  );
  if (ids.length === 0) return [];

  const fields = [
    "System.Id",
    "System.Title",
    "System.State",
    "System.WorkItemType",
    "System.AssignedTo",
    "System.AreaPath",
    "System.Description",
    "Microsoft.VSTS.Common.AcceptanceCriteria",
  ].join(",");

  // Work-item batch GET is capped at 200 ids; chunk to be safe.
  const tickets: Ticket[] = [];
  for (let i = 0; i < ids.length; i += 200) {
    const chunk = ids.slice(i, i + 200);
    const batchUrl = `https://dev.azure.com/${ORG}/_apis/wit/workitems?ids=${chunk.join(
      ","
    )}&fields=${fields}&${API}`;
    const det = await adoGet<{ value: WorkItemDetail[] }>(batchUrl);
    for (const w of det.value) {
      const f = w.fields;
      const area = (f["System.AreaPath"] as string) ?? "";
      const assignedTo = f["System.AssignedTo"] as { displayName?: string } | undefined;
      tickets.push({
        id: String(f["System.Id"]),
        title: (f["System.Title"] as string) ?? "",
        type: (f["System.WorkItemType"] as string) ?? "Task",
        status: (f["System.State"] as string) ?? "New",
        assignee: assignedTo?.displayName ?? "Unassigned",
        areaPath: area,
        project: lastAreaSegment(area) || (process.env.CLAUDE_DEFAULT_PROJECT ?? ""),
        description: htmlToText((f["System.Description"] as string) ?? ""),
        criteria: htmlToLines(
          (f["Microsoft.VSTS.Common.AcceptanceCriteria"] as string) ?? ""
        ),
      });
    }
  }

  // Keep ADO's board order roughly stable by id.
  return tickets;
}
