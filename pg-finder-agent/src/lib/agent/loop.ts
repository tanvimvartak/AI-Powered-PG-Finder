/**
 * The agent loop.
 *
 *   user text ─► Gemini(+tools) ─► functionCall(s) ─► execute ─► functionResponse(s) ─┐
 *                    ▲                                                                │
 *                    └────────────────────────────────────────────────────────────────┘
 *   ... until Gemini answers with plain text (final answer) or MAX_ITERATIONS is hit.
 *
 * Every step is streamed to the UI through `emit` (SSE).
 *
 * Resilience: if Gemini becomes unavailable (e.g. all free-tier quotas used up),
 * `runOfflinePlanner` finishes the job with the same tools in a fixed order, so
 * the user still gets honest results. This is announced in the timeline.
 */
import "server-only";
import { generate, type GeminiContent, type GeminiPart } from "../gemini";
import type { AgentEvent, AgentRequestBody } from "../types";
import { executeTool, stepLabel, type AgentSession } from "./executor";
import { isoDate, todayIST, WEEKDAYS } from "./parser";
import { AGENT_SYSTEM_PROMPT, STRICT_NOTE } from "./systemPrompt";
import { TOOL_DECLARATIONS } from "./tools";

export const MAX_ITERATIONS = 10;

type Call = { id?: string; name: string; args: Record<string, unknown> };

/** Execute one turn's tool calls in parallel. */
async function runCalls(calls: Call[], session: AgentSession, nextStep: () => string): Promise<GeminiPart[]> {
  const sids = calls.map((c) => {
    const sid = nextStep();
    session.emit({ type: "step", id: sid, status: "running", label: stepLabel(c.name, c.args), tool: c.name, input: c.args });
    return sid;
  });

  return Promise.all(
    calls.map(async (c, i) => {
      try {
        const { result, summary } = await executeTool(c.name, c.args, session);
        session.emit({ type: "step", id: sids[i], status: result.error ? "error" : "done", label: summary, tool: c.name, input: c.args, output: result });
        return { functionResponse: { id: c.id, name: c.name, response: result } };
      } catch (e) {
        const msg = (e as Error).message;
        session.emit({ type: "step", id: sids[i], status: "error", label: `${c.name} failed: ${msg.slice(0, 120)}`, tool: c.name, input: c.args });
        return { functionResponse: { id: c.id, name: c.name, response: { error: msg } } };
      }
    }),
  );
}

export async function runAgent(body: AgentRequestBody, emit: (e: AgentEvent) => void, signal?: AbortSignal) {
  const session: AgentSession = { body, drafts: {}, relaxations: [], emit };
  const today = todayIST();
  const system = AGENT_SYSTEM_PROMPT.replace("{TODAY}", `${isoDate(today)} (${WEEKDAYS[today.getUTCDay()]})`).replace("{STRICT}", body.strict ? STRICT_NOTE : "");
  const contents: GeminiContent[] = [{ role: "user", parts: [{ text: body.text }] }];
  let stepNo = 0;
  const nextStep = () => `s${++stepNo}`;

  for (let iter = 1; iter <= MAX_ITERATIONS; iter++) {
    if (signal?.aborted) return;
    let res;
    try {
      res = await generate(
        { contents, systemInstruction: { parts: [{ text: system }] }, tools: TOOL_DECLARATIONS, toolConfig: { functionCallingConfig: { mode: "AUTO" } } },
        { signal, onRetry: (msg) => emit({ type: "thought", text: msg }) },
      );
    } catch (e) {
      if (signal?.aborted) return;
      emit({ type: "thought", text: `Gemini is unavailable (${(e as Error).message.slice(0, 90)}). Finishing with the built-in offline planner using the same tools.` });
      return runOfflinePlanner(session, nextStep);
    }
    // Keep the model turn verbatim (incl. thought signatures required by Gemini 3 for multi-turn tool use).
    contents.push(res.content);

    const calls: Call[] = res.content.parts.filter((p) => p.functionCall).map((p) => ({ id: p.functionCall!.id, name: p.functionCall!.name, args: p.functionCall!.args ?? {} }));
    const text = res.content.parts
      .filter((p) => p.text && !p.thought)
      .map((p) => p.text)
      .join("")
      .trim();

    if (!calls.length) {
      emit({ type: "final", text: text || "I couldn't produce a summary, but the results are shown below." });
      return;
    }
    if (text) emit({ type: "thought", text });

    const responses = await runCalls(calls, session, nextStep);
    contents.push({ role: "user", parts: responses });

    // Clarification needed → stop early; the UI shows the question.
    if (session.parsed?.clarification_question) {
      emit({ type: "final", text: session.parsed.clarification_question });
      return;
    }
  }

  emit({ type: "final", text: "I hit my step limit before finishing. Here is what I found so far. You can tweak the chips above and re-run." });
}

/**
 * Deterministic fallback "planner": same tools, fixed order, same relaxation
 * policy. Reuses whatever the LLM agent already completed in this session.
 */
async function runOfflinePlanner(s: AgentSession, nextStep: () => string) {
  const one = async (name: string, args: Record<string, unknown>) => {
    const [r] = await runCalls([{ name, args }], s, nextStep);
    return r.functionResponse!.response as Record<string, unknown>;
  };

  if (!s.parsed) await one("parse_request", { text: s.body.text });
  const p = s.parsed!;
  if (p.clarification_question || !p.landmark) {
    s.emit({ type: "final", text: p.clarification_question ?? "Which college, station or area should the PG be near?" });
    return;
  }
  if (!s.point) {
    await one("geocode", { place_name: p.landmark, city_hint: p.city_hint });
    if (!s.point) {
      s.emit({ type: "final", text: `I couldn't find "${p.landmark}" on the map. Could you give a nearby station or area name?` });
      return;
    }
  }

  let radius = s.lastSearch?.radius_m ?? p.radius_m;
  let max = s.lastSearch ? s.lastSearch.max_price : p.max_budget;
  let res = await one("search_listings", { lat: s.point.lat, lng: s.point.lng, radius_m: radius, min_price: p.min_budget, max_price: max, gender: p.preferences.gender });
  for (let i = 0; i < 3 && res.strict_matches === 0 && !s.body.strict; i++) {
    const hint = String(res.relaxation_hint ?? "");
    const r = hint.match(/radius_m=(\d+)/);
    const b = hint.match(/max_price=(\d+)/);
    if (r) radius = +r[1];
    else if (b) max = +b[1];
    else break;
    res = await one("search_listings", { lat: s.point.lat, lng: s.point.lng, radius_m: radius, min_price: p.min_budget, max_price: max, gender: p.preferences.gender });
  }

  if (!s.lastSearch?.hits.length) {
    s.emit({
      type: "final",
      text: `No PG or student accommodations found near "${p.landmark}" within ${(radius / 1000).toFixed(1)} km across live public sources. Try a larger radius or a nearby landmark.`,
    });
    return;
  }
  await one("rank_listings", { radius_m: radius, max_budget: max, deadline_date: p.deadline_date, sort_preference: p.sort_preference });
  const top = (s.ranked ?? []).slice(0, 2);
  if (top.length) {
    await runCalls(top.map((r) => ({ name: "draft_enquiry", args: { listing_id: r.listing.id } })), s, nextStep);
  }

  const best = top[0];
  const relax = s.relaxations.length
    ? ` Note: I expanded the search to ${(radius / 1000).toFixed(1)} km to discover real options.`
    : "";
  s.emit({
    type: "final",
    text: `Found accommodation options near ${p.landmark} within ${(radius / 1000).toFixed(1)} km.${relax} Top match: ${best.listing.name} (${best.why}). I have prepared pre-drafted enquiries for you to review and send to owners. Listings come from live public sources. Prices and availability are unverified until you confirm with the owner.`,
  });
}
