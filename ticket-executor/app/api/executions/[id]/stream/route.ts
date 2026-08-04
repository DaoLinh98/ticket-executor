import { getRun } from "@/lib/executionStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Server-Sent Events endpoint for a running run's live log/progress —
// replaces client-side 1.2s polling with push updates. Polls the in-process
// store internally (cheap, no network) and only emits a `data:` frame when
// the run actually changed, closing the stream once it reaches a terminal
// state or parks at a gate, or the client disconnects.
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

      const send = (run: unknown) => {
        const payload = JSON.stringify({ run });
        if (payload === lastPayload) return;
        lastPayload = payload;
        controller.enqueue(encoder.encode(`data: ${payload}\n\n`));
      };

      const tick = async () => {
        if (closed) return;
        const run = await getRun(id);
        if (!run) {
          if (!lastPayload) controller.enqueue(encoder.encode(`data: ${JSON.stringify({ error: "Run not found" })}\n\n`));
          controller.close();
          closed = true;
          return;
        }
        send(run);
        // "waiting" is terminal for the stream too: no child process is alive, and
        // the run only moves again once a human resolves the gate (the client
        // reopens the stream after that).
        if (run.state !== "running") {
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
