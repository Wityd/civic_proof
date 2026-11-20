// AI layer (Gemini): "Rules decide, AI explains."
//
// The deterministic rules (rules.ts) produce every flag, amount and the recommendation.
// Gemini only rewrites them as a short, plain-language explanation for the official,
// and may point out things fixed rules cannot see (e.g. a description that does not
// match its declared category) as advisory remarks.
//
// Guardrails: the AI can only make the outcome MORE cautious, never less. It never
// removes a flag or changes an amount; a line it says does not fit its declared category
// adds an AI_CATEGORY_CONCERN check (medium), which turns an APPROVE into HOLD_FOR_REVIEW.
// It can never approve, reject or clear anything. Any reply that contains a number not
// present in the rule results, or accuses anyone of fraud, is discarded. On any problem
// (no key, timeout, bad reply) the rules review is kept unchanged (mode 'rules'). The
// analysis can never fail because of the AI.
import type { AnalysisContext } from './rules.ts';

// deno-lint-ignore no-explicit-any
type Review = { explanation: string; mode: string; checks: any[]; benchmarks: any[]; recommendation: string; potential_excess_cents: number; [k: string]: any };
export type Env = { get(key: string): string | undefined };
type Fetch = (url: string, init: RequestInit) => Promise<Response>;

// Tried in order. A model that is retired (404), overloaded (429/500/503) or too slow
// falls through to the next. Measured: 3.8-flash answers in ~2-6 s but is often
// overloaded; 3.5-flash took 12-13 s (too slow for someone waiting), so it is left out;
// 3.1-flash-lite is the fast last resort. Stable models only: no previews or aliases.
const DEFAULT_MODELS = 'gemini-3.8-flash,gemini-3.1-flash-lite';
// Each model gets at most this long, so a slow one can never starve the next.
const PER_MODEL_MS = 7000;
const NEXT_MODEL_ON = new Set([404, 429, 500, 503]);
// A safety net, not a target: typical replies take a few seconds; the rules answer if it trips.
const TIMEOUT_MS = 15000;
const CLOSING = 'AI recommends; authorised humans decide.';

const rand = (cents: number) =>
  'R' + (cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** The only facts Gemini sees: the rules' own results, in rand. */
export function factsFor(review: Review, ctx: AnalysisContext) {
  return {
    supplier: { name: ctx.supplier.name, registration_no: ctx.supplier.registration_no, registered_on: ctx.supplier.registered_on, verified: ctx.supplier.verified },
    invoice: { number: ctx.invoice.invoice_number, date: ctx.invoice.invoice_date, total: rand(ctx.invoice.total_cents) },
    project_permitted_categories: ctx.project.permitted_categories,
    line_items: ctx.items.map((i, line) => ({ line, description: i.description, declared_category: i.category, quantity: i.quantity, unit_price: rand(i.unit_price_cents), line_total: rand(i.line_total_cents), reference_sku: i.reference_sku ?? null })),
    rule_checks: review.checks.map((c) => ({ code: c.code, severity: c.severity, detail: c.detail, ...(c.line === undefined ? {} : { line: c.line }) })),
    benchmarks: review.benchmarks.map((b) => ({ line: b.line, sku: b.sku, benchmark_unit_price: rand(b.benchmark_unit_cents), invoice_unit_price: rand(b.invoice_unit_cents), benchmark_total: rand(b.benchmark_total_cents), excess: rand(b.excess_cents) })),
    potential_excess: rand(review.potential_excess_cents),
    rule_recommendation: review.recommendation,
  };
}

const PROMPT = `You assist a South African municipal official who must decide whether to pay a supplier invoice from a public project.
Deterministic rules have ALREADY checked the invoice. Their results are in RULE_RESULTS below. You do NOT decide anything.

Write a plain-language explanation of 2 to 4 short sentences for the official:
- Say what the rules found and why it matters, most important first. If nothing was flagged, say so briefly.
- If a line item's description clearly does not fit its declared_category (for example a vehicle declared as pipes), mention it as an observation for the reviewer to check, AND list that line number in category_mismatch_lines. Only list clear mismatches; when in doubt, leave it out.
- Use ONLY numbers, amounts, percentages and dates that appear in RULE_RESULTS, written exactly as they appear there. Never calculate or invent a figure.
- Keep every figure with its own meaning: unit prices compare with benchmark unit prices; "excess" and "potential_excess" are TOTALS for the line or invoice. Never say a unit price exceeds anything by a total amount.
- Never call the supplier fraudulent, corrupt or criminal, and never guess motives. Describe facts and say what to verify.
- Refer to line items by their description (e.g. "the 4x4 double-cab bakkie"), never as "line 0". Write categories and checks in plain words, not codes or field names ("water storage", not "water_storage" or declared_category).
- Do not repeat the recommendation code verbatim and do not add a closing disclaimer.

RULE_RESULTS:
`;

/** Every number in a text, normalised: "R118,400.00" → "118400", "131%" → "131". */
export function numbersIn(text: string): string[] {
  return (text.match(/\d+(?:[.,]\d+)*/g) ?? []).map((n) => n.replace(/,/g, '').replace(/\.0+$/, '').replace(/(\.\d*?)0+$/, '$1'));
}

/** Guardrail: reject replies with invented numbers or accusations. Returns a reason, or null if safe. */
export function rejectReason(text: string, facts: unknown, rulesExplanation: string): string | null {
  if (text.length < 30 || text.length > 900) return 'length';
  if (/\b(fraud\w*|corrupt\w*|criminal|stole|steal\w*|theft|bribe\w*|kickback\w*)\b/i.test(text)) return 'accusation';
  const allowed = new Set([...numbersIn(JSON.stringify(facts)), ...numbersIn(rulesExplanation)]);
  const invented = numbersIn(text).filter((n) => !allowed.has(n) && !(Number(n) >= 0 && Number(n) <= 10 && /^\d+$/.test(n)));
  return invented.length ? `invented numbers: ${invented.join(', ')}` : null;
}

/**
 * Returns the review with a Gemini explanation (mode 'llm'), or the untouched rules review.
 * Never throws.
 */
export async function explainWithAI(review: Review, ctx: AnalysisContext, env: Env, fetchFn: Fetch = fetch): Promise<Review> {
  const key = env.get('GEMINI_API_KEY');
  if (env.get('AI_MODE') !== 'llm' || !key) return review;
  const facts = factsFor(review, ctx);
  const models = (env.get('GEMINI_MODEL') || DEFAULT_MODELS).split(',').map((m) => m.trim()).filter(Boolean);
  const deadline = Date.now() + Number(env.get('AI_TIMEOUT_MS') || TIMEOUT_MS);
  const perModel = Number(env.get('AI_MODEL_TIMEOUT_MS') || PER_MODEL_MS);
  for (const model of models) {
    const budget = Math.min(perModel, deadline - Date.now());
    if (budget <= 0) break;
    let reply: { status: number; text: string };
    try {
      reply = await attempt(fetchFn, model, key, facts, budget);
    } catch (e) {
      console.warn(`ai: ${model} ${(e as Error)?.name === 'AbortError' ? `gave no answer within ${budget} ms` : 'request failed'}; trying the next model`);
      continue;
    }
    if (NEXT_MODEL_ON.has(reply.status)) { console.warn(`ai: ${model} unavailable (HTTP ${reply.status}); trying the next model`); continue; }
    if (reply.status !== 200) { console.warn(`ai: Gemini HTTP ${reply.status}; keeping rules explanation`); return review; }
    try {
      const body = JSON.parse(reply.text);
      const raw = body?.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text ?? '').join('') ?? '';
      const parsed = JSON.parse(raw);
      const explanation = String(parsed?.explanation ?? '').replace(/\s+/g, ' ').trim();
      const problem = rejectReason(explanation, facts, review.explanation);
      if (problem) { console.warn(`ai: ${model} reply rejected (${problem}); keeping rules explanation`); return review; }
      console.info(`ai: explained by ${model}`);
      return applyConcerns({ ...review, explanation: `${explanation} ${CLOSING}`, mode: 'llm' }, ctx, parsed?.category_mismatch_lines);
    } catch {
      console.warn(`ai: ${model} sent an unreadable reply; keeping rules explanation`);
      return review;
    }
  }
  console.warn('ai: no model answered in time; keeping rules explanation');
  return review;
}

/** One model, one time slice. The whole reply is read inside the slice. */
async function attempt(fetchFn: Fetch, model: string, key: string, facts: unknown, budgetMs: number) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), budgetMs);
  try {
    let res = await callGemini(fetchFn, model, key, facts, controller.signal, true);
    let text = await res.text();
    if (res.status === 400 && /thinking/i.test(text)) {
      // This model does not accept a thinking level: ask again without it.
      res = await callGemini(fetchFn, model, key, facts, controller.signal, false);
      text = await res.text();
    }
    return { status: res.status, text };
  } finally {
    clearTimeout(timer);
  }
}

function callGemini(fetchFn: Fetch, model: string, key: string, facts: unknown, signal: AbortSignal, lowThinking: boolean) {
  return fetchFn(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
      method: 'POST',
      signal,
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: PROMPT + JSON.stringify(facts, null, 2) }] }],
        generationConfig: {
          temperature: 0.2,
          // Newer models "think" first and that counts against this limit: keep headroom so
          // the short JSON answer is never cut off.
          maxOutputTokens: 2048,
          // The rules already did the reasoning; the model only has to word it. Low thinking
          // effort is what makes replies fast enough for an official waiting on screen.
          ...(lowThinking ? { thinkingConfig: { thinkingLevel: 'low' } } : {}),
          responseMimeType: 'application/json',
          responseSchema: {
            type: 'OBJECT',
            properties: { explanation: { type: 'STRING' }, category_mismatch_lines: { type: 'ARRAY', items: { type: 'INTEGER' } } },
            required: ['explanation'],
          },
        },
      }),
  });
}

/**
 * AI concerns can only add caution: each valid mismatched line adds a medium
 * AI_CATEGORY_CONCERN check, and an APPROVE becomes HOLD_FOR_REVIEW. HOLD and REJECT
 * are never softened, and no existing check is touched.
 */
export function applyConcerns(review: Review, ctx: AnalysisContext, lines: unknown): Review {
  // Only the hidden case counts: a line whose category IS permitted (so the rules passed it)
  // but whose description does not fit. Lines the rules already flagged need no AI concern.
  const ruleFlagged = new Set(review.checks.filter((c) => c.code === 'PURPOSE_MISMATCH').map((c) => c.line));
  const valid = [...new Set(Array.isArray(lines) ? lines : [])]
    .filter((l): l is number => Number.isInteger(l) && l >= 0 && l < ctx.items.length && !ruleFlagged.has(l));
  if (!valid.length) return review;
  const added = valid.map((line) => ({
    code: 'AI_CATEGORY_CONCERN', severity: 'medium', line,
    detail: `AI: the description "${ctx.items[line].description}" does not appear to match its declared category "${ctx.items[line].category}". Verify before paying.`,
  }));
  return {
    ...review,
    checks: [...review.checks, ...added],
    flags: [...new Set([...(review.flags ?? []), 'AI_CATEGORY_CONCERN'])],
    recommendation: review.recommendation === 'APPROVE' ? 'HOLD_FOR_REVIEW' : review.recommendation,
  };
}
