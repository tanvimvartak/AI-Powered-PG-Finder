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
import type { AgentEvent, AgentRequestBody, OwnerReply } from "../types";
import { executeTool, simulateOwners, stepLabel, type AgentSession } from "./executor";
import { isoDate, todayIST, WEEKDAYS } from "./parser";
import { AGENT_SYSTEM_PROMPT, STRICT_NOTE } from "./systemPrompt";
import { TOOL_DECLARATIONS } from "./tools";

export const MAX_ITERATIONS = 10;

type Call = { id?: string; name: string; args: Record<string, unknown> };

/** Execute one turn's tool calls in parallel; batch multiple contact_owner calls into one LLM request. */
async function runCalls(calls: Call[], session: AgentSession, nextStep: () => string): Promise<GeminiPart[]> {
  const sids = calls.map((c) => {
    const sid = nextStep();
    session.emit({ type: "step", id: sid, status: "running", label: stepLabel(c.name, c.args), tool: c.name, input: c.args });
    return sid;
  });

  // Batch owner role-play (one Gemini call for N owners → saves free-tier quota)
  const contacts = calls.filter((c) => c.name === "contact_owner");
  if (contacts.length > 1) {
    const replies = await simulateOwners(
      contacts.map((c) => ({ listingId: String(c.args.listing_id), message: String(c.args.message ?? "") })),
      session.parsed,
    );
    session.prefetchedReplies = Object.fromEntries(replies.map((r: OwnerReply) => [r.listing_id, r]));
  }

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
  const session: AgentSession = { body, replies: {}, relaxations: [], emit };
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
    s.emit({ type: "final", text: `No PGs found near ${p.landmark} even after relaxing constraints. Try a bigger radius or budget. (Offline planner; all listings are sample data.)` });
    return;
  }
  await one("rank_listings", { radius_m: radius, max_budget: max, deadline_date: p.deadline_date, sort_preference: p.sort_preference });
  const top = (s.ranked ?? []).slice(0, 3);
  const msg = (name: string) =>
    `Hi, I'm a student looking for a PG bed${p.deadline_date ? ` from ${p.deadline_date}` : ""}${p.max_budget ? `, budget around Rs ${p.max_budget}` : ""}. Is a bed available at ${name}? What is the final rent and when can I visit?`;
  if (top.length) await runCalls(top.map((r) => ({ name: "contact_owner", args: { listing_id: r.listing.id, message: msg(r.listing.name) } })), s, nextStep);

  const best = top[0];
  const relax = s.relaxations.length ? ` I had to relax: ${s.relaxations.map((r) => (r.kind === "radius" ? `radius to ${(r.to / 1000).toFixed(1)} km` : `budget to Rs ${r.to.toLocaleString("en-IN")}`)).join(", ")}.` : "";
  s.emit({
    type: "final",
    text: `Searched near ${p.landmark} within ${(radius / 1000).toFixed(1)} km${max ? ` under Rs ${max.toLocaleString("en-IN")}` : ""}${p.deadline_date ? `, move-in by ${p.deadline_date}` : ""}.${relax} Top pick: ${best.listing.name}: ${best.why}.${best.red_flags.length ? ` Watch out: ${best.red_flags[0]}.` : ""} I messaged ${top.length} owners (simulated replies). (Summary written by the offline planner because Gemini was unavailable.) All listings are sample data.`,
  });
}
