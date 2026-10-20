/**
 * Minimal Gemini REST client (server-side only).
 *
 * - Uses the public Generative Language API with the free-tier key in .env.
 * - Model is config driven (GEMINI_MODEL) with a fallback chain
 *   (GEMINI_FALLBACK_MODELS) because free-tier quotas are per model and per day.
 * - A separate "light" chain (GEMINI_LIGHT_MODELS) serves simple structured calls.
 * - Retries transient failures (429 / 5xx / network), honouring the
 *   `retryDelay` hint Google returns on 429s.
 */
import "server-only";

const API_BASE = "https://generativelanguage.googleapis.com/v1beta/models";

export type GeminiPart = {
  text?: string;
  thought?: boolean;
  thoughtSignature?: string;
  functionCall?: { id?: string; name: string; args?: Record<string, unknown> };
  functionResponse?: { id?: string; name: string; response: Record<string, unknown> };
};
export type GeminiContent = { role: "user" | "model"; parts: GeminiPart[] };

export interface GenerateRequest {
  contents: GeminiContent[];
  systemInstruction?: { parts: { text: string }[] };
  tools?: unknown[];
  toolConfig?: unknown;
  generationConfig?: Record<string, unknown>;
}

export interface GenerateResult {
  content: GeminiContent;
  model: string;
  finishReason?: string;
}

export class GeminiError extends Error {
  constructor(
    message: string,
    public status?: number,
  ) {
    super(message);
  }
}

const list = (v: string | undefined, d: string) =>
  (v || d)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

export function geminiConfig() {
  const model = process.env.GEMINI_MODEL || "gemini-3.5-flash";
  return {
    apiKey: process.env.GEMINI_API_KEY?.trim() || "AQ.Ab8RN6IPIYuFPyrmGux6b2umiog54zO8jaP1mGXMwnQq70RNAA",
    model,
    /** Tried in order when the primary is rate-limited / out of daily free quota. */
    fallbacks: list(process.env.GEMINI_FALLBACK_MODELS ?? process.env.GEMINI_FALLBACK_MODEL, "gemini-flash-lite-latest,gemini-3.1-flash-lite,gemini-flash-latest"),
    /** Cheaper model chain for simple structured calls (parse_request, owner role-play). */
    light: list(process.env.GEMINI_LIGHT_MODELS, "gemini-flash-lite-latest,gemini-3.1-flash-lite,gemini-3.5-flash"),
    /** Gemini 3 "thinkingLevel" (minimal|low|medium|high). Lower = faster. Empty = model default. */
    thinking: process.env.GEMINI_THINKING_LEVEL ?? "low",
  };
}

/** Models that rejected thinkingConfig once; we stop sending it to them. */
const noThinking = new Set<string>();
/** model → epoch ms until which we consider it exhausted (daily free-tier quota hit). */
const exhaustedUntil = new Map<string, number>();

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Parse Google's "retryDelay": "12s" hint from an error body. */
function retryDelayMs(body: string): number | null {
  const m = body.match(/"retryDelay":\s*"(\d+(?:\.\d+)?)s"/);
  return m ? Math.ceil(parseFloat(m[1]) * 1000) : null;
}

type ErrX = GeminiError & { retryMs?: number | null; perDay?: boolean };

async function callModel(model: string, req: GenerateRequest, apiKey: string, signal?: AbortSignal): Promise<GenerateResult> {
  const { thinking } = geminiConfig();
  const withThinking = thinking && !noThinking.has(model);
  const payload = withThinking ? { ...req, generationConfig: { ...req.generationConfig, thinkingConfig: { thinkingLevel: thinking } } } : req;
  const res = await fetch(`${API_BASE}/${model}:generateContent`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
    body: JSON.stringify(payload),
    signal,
  });
  const body = await res.text();
  if (res.status === 400 && withThinking && /thinking/i.test(body) && !/signature/i.test(body)) {
    noThinking.add(model); // model doesn't support thinkingLevel → retry without it
    return callModel(model, req, apiKey, signal);
  }
  if (res.status === 400 && /signature/i.test(body)) {
    // History came from a different model (after a fallback switch): use the documented
    // dummy signature so the new model accepts earlier function calls.
    const fixed = {
      ...req,
      contents: req.contents.map((c) => ({
        ...c,
        parts: c.parts.map((p) => (p.functionCall ? { ...p, thoughtSignature: "skip_thought_signature_validator" } : p.thoughtSignature ? { ...p, thoughtSignature: undefined } : p)),
      })),
    };
    if (JSON.stringify(fixed) !== JSON.stringify(req)) return callModel(model, fixed, apiKey, signal);
  }
  if (!res.ok) {
    const err = new GeminiError(`Gemini ${model} HTTP ${res.status}: ${body.slice(0, 300)}`, res.status) as ErrX;
    err.retryMs = retryDelayMs(body);
    err.perDay = res.status === 429 && /PerDay/i.test(body);
    throw err;
  }
  const json = JSON.parse(body);
  const cand = json.candidates?.[0];
  if (!cand?.content?.parts) {
    const reason = cand?.finishReason || json.promptFeedback?.blockReason || "empty response";
    throw new GeminiError(`Gemini returned no content (${reason})`, 502);
  }
  return { content: { role: "model", parts: cand.content.parts }, model: json.modelVersion || model, finishReason: cand.finishReason };
}

/**
 * generateContent with retries across a model chain.
 * - daily quota exhausted (429 PerDay) → mark model exhausted, move on immediately
 * - per-minute limit / 5xx / network → short wait (≤8s) and retry once, then next model
 * - 404 (model renamed/retired) → next model
 */
export async function generate(
  req: GenerateRequest,
  opts: { signal?: AbortSignal; onRetry?: (msg: string) => void; tier?: "agent" | "light" } = {},
): Promise<GenerateResult> {
  const cfg = geminiConfig();
  if (!cfg.apiKey) throw new GeminiError("GEMINI_API_KEY is missing. Add it to .env (see .env.example).", 401);

  const chain = [...new Set(opts.tier === "light" ? cfg.light : [cfg.model, ...cfg.fallbacks])];
  const now = Date.now();
  const usable = chain.filter((m) => (exhaustedUntil.get(m) ?? 0) < now);
  if (!usable.length) throw new GeminiError("All configured Gemini models are out of free-tier quota (RESOURCE_EXHAUSTED).", 429);

  let lastErr: unknown;
  for (let i = 0; i < usable.length; i++) {
    const model = usable[i];
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        return await callModel(model, req, cfg.apiKey, opts.signal);
      } catch (e) {
        lastErr = e;
        const err = e as ErrX;
        if (opts.signal?.aborted) throw e;
        if (err.status && [400, 401, 403].includes(err.status)) throw e;
        if (err.perDay) {
          exhaustedUntil.set(model, Date.now() + (err.retryMs ?? 3600_000));
          if (usable[i + 1]) opts.onRetry?.(`${model} hit its free daily quota, switching to ${usable[i + 1]}...`);
          break;
        }
        if (err.status === 404) break;
        const wait = Math.min(err.retryMs ?? 2000 * (attempt + 1), 8000);
        if (attempt === 0 && (err.retryMs ?? 0) <= 8000) {
          opts.onRetry?.(`Gemini busy (${err.status ?? "network"}), retrying in ${Math.round(wait / 1000)}s...`);
          await sleep(wait);
          continue;
        }
        if (usable[i + 1]) opts.onRetry?.(`${model} unavailable, switching to ${usable[i + 1]}...`);
        break;
      }
    }
  }
  throw lastErr;
}

/** Convenience: one-shot JSON generation with a response schema (uses the light model chain). */
export async function generateJson<T>(prompt: string, schema: unknown, system?: string): Promise<T> {
  const res = await generate(
    {
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      systemInstruction: system ? { parts: [{ text: system }] } : undefined,
      generationConfig: { responseMimeType: "application/json", responseSchema: schema },
    },
    { tier: "light" },
  );
  const text = res.content.parts
    .filter((p) => p.text && !p.thought)
    .map((p) => p.text)
    .join("");
  return JSON.parse(text) as T;
}
