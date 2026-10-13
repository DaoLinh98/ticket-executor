const POLL_MS = 1500;
const HEARTBEAT_MS = 15000;

export function liveStream(req: Request, fingerprint: () => Promise<string>): Response {
  let closed = false;
  let timer: ReturnType<typeof setTimeout>;
  let beat: ReturnType<typeof setInterval>;

  const stop = () => {
    closed = true;
    clearTimeout(timer);
    clearInterval(beat);
  };

  const stream = new ReadableStream({
    start(controller) {
      const encoder = new TextEncoder();
      let last = "";

      const tick = async () => {
        if (closed) return;
        try {
          const next = await fingerprint();
          if (next !== last) {
            last = next;
            controller.enqueue(encoder.encode("data: changed\n\n"));
          }
        } catch {}
        if (!closed) timer = setTimeout(tick, POLL_MS);
      };

      beat = setInterval(() => {
        if (!closed) controller.enqueue(encoder.encode(": ping\n\n"));
      }, HEARTBEAT_MS);
      tick();
      req.signal.addEventListener("abort", () => {
        stop();
        try {
          controller.close();
        } catch {}
      });
    },
    cancel: stop,
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
