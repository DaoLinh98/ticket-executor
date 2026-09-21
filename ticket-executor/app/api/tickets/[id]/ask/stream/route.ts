import { getAsk } from "@/lib/ask";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Server-Sent Events for one ticket's ad-hoc Claude session, the same shape the
// run stream uses: poll the in-process session (cheap, no network), emit only
// when it actually changed, close once the turn ends or the client disconnects.
// `seq` is what "changed" means here — the transcript is append-only, so
// comparing one number beats re-serialising every line each tick.
const POLL_MS = 500;

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  let closed = false;
  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();
      let lastSeq = -1;
      let timer: ReturnType<typeof setTimeout>;

      const tick = () => {
        if (closed) return;
        const ask = getAsk(id);
        if (!ask) {
          controller.close();
          closed = true;
          return;
        }
        if (ask.seq !== lastSeq) {
          lastSeq = ask.seq;
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ ask })}\n\n`));
        }
        // The final frame above already carries the finished state, so the client
        // has the answer before the stream goes away.
        if (ask.state !== "running") {
          controller.close();
          closed = true;
          return;
        }
        timer = setTimeout(tick, POLL_MS);
      };

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
