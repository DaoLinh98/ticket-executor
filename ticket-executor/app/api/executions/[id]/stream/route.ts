import { getExecution, getPersistedExecution } from "@/lib/executionStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Server-Sent Events endpoint for a running execution's live log/status —
// replaces client-side 1.2s polling with push updates. Polls the in-process
// store internally (cheap, no network) and only emits a `data:` frame when
// the execution actually changed, closing the stream once it reaches a
// terminal status (completed/failed) or the client disconnects.
const POLL_MS = 700;

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  let closed = false;
  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();
      let lastPayload = "";

      const send = (execution: unknown) => {
        const payload = JSON.stringify({ execution });
        if (payload === lastPayload) return;
        lastPayload = payload;
        controller.enqueue(encoder.encode(`data: ${payload}\n\n`));
      };

      const tick = async () => {
        if (closed) return;
        const execution = getExecution(id) ?? (await getPersistedExecution(id));
        if (!execution) {
          if (!lastPayload) controller.enqueue(encoder.encode(`data: ${JSON.stringify({ error: "Execution not found" })}\n\n`));
          controller.close();
          closed = true;
          return;
        }
        send(execution);
        // "awaiting-approval" is terminal for the stream too: no child process is
        // running, and the run only moves again once the user resolves the plan
        // (the client reopens the stream after that).
        if (execution.status === "completed" || execution.status === "failed" || execution.status === "awaiting-approval") {
          controller.close();
          closed = true;
          return;
        }
        timer = setTimeout(tick, POLL_MS);
      };

      let timer: ReturnType<typeof setTimeout>;
      tick();

      req.signal.addEventListener("abort", () => {
        closed = true;
        clearTimeout(timer);
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
