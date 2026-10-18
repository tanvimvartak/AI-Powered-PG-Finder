/**
 * POST /api/agent  (Server-Sent Events)
 * Body: AgentRequestBody. Streams AgentEvent objects as `data: {...}\n\n`.
 */
import { runAgent } from "@/lib/agent/loop";
import type { AgentEvent, AgentRequestBody } from "@/lib/types";

// POST route handlers are always dynamic (no `dynamic` export: incompatible with cacheComponents in Next 16)
export const maxDuration = 120;

export async function POST(req: Request) {
  let body: AgentRequestBody;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!body?.text?.trim()) return Response.json({ error: "Please describe what you're looking for." }, { status: 400 });
  body.text = body.text.trim().slice(0, 500);

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      let closed = false;
      const emit = (e: AgentEvent) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(e)}\n\n`));
        } catch {
          closed = true;
        }
      };
      // keep-alive comments so proxies don't drop a slow stream
      const ka = setInterval(() => !closed && controller.enqueue(encoder.encode(`: ping\n\n`)), 15000);
      try {
        await runAgent(body, emit, req.signal);
      } catch (e) {
        const msg = (e as Error).message || "Unknown error";
        const friendly = /429|quota|RESOURCE_EXHAUSTED/i.test(msg)
          ? "The free Gemini quota is temporarily exhausted. Please wait a minute and try again."
          : /API key|401|403/i.test(msg)
            ? "Gemini API key is missing or invalid. Check GEMINI_API_KEY in .env."
            : `Something went wrong: ${msg.slice(0, 200)}`;
        emit({ type: "error", message: friendly });
      } finally {
        clearInterval(ka);
        emit({ type: "done" });
        closed = true;
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive", "X-Accel-Buffering": "no" },
  });
}
