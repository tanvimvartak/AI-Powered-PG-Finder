/**
 * POST /api/parse  { text } → ParsedRequest
 * Stage-3 debug endpoint: runs only the parse_request tool.
 */
import { parseRequest } from "@/lib/agent/parser";

export async function POST(req: Request) {
  try {
    const { text, overrides } = await req.json();
    if (!text || typeof text !== "string") return Response.json({ error: "text is required" }, { status: 400 });
    const result = await parseRequest(text.slice(0, 500), overrides);
    return Response.json(result);
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 500 });
  }
}
