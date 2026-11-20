import { explainWithAI, numbersIn, rejectReason } from './ai.ts';
import { DEMO } from './demo_contexts.ts';
import { analyse } from './rules.ts';

function assert(ok: unknown, message: string): asserts ok { if (!ok) throw new Error(message); }
const env = (vars: Record<string, string>) => ({ get: (k: string) => vars[k] });
const ON = { AI_MODE: 'llm', GEMINI_API_KEY: 'test-key' };
const gemini = (explanation: string) => async () =>
  new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify({ explanation }) }] } }] }), { status: 200 });

const pipes = DEMO['#2 pipes'];
const rules = analyse(pipes);

Deno.test('off by default: AI_MODE unset or no key keeps the rules review untouched', async () => {
  let called = false;
  const spy = async () => { called = true; return new Response('{}'); };
  assert((await explainWithAI(rules, pipes, env({}), spy)) === rules, 'AI_MODE unset');
  assert((await explainWithAI(rules, pipes, env({ AI_MODE: 'llm' }), spy)) === rules, 'no key');
  assert(!called, 'Gemini must not be called');
});

Deno.test('a safe reply becomes the explanation; rules still decide everything else', async () => {
  const text = 'The unit price of R12,000.00 is far above the R5,200.00 benchmark, a potential excess of R136,000.00. Pipeworks Direct CC registered on 2026-10-28 and is unverified, so confirm its standing before deciding.';
  const out = await explainWithAI(rules, pipes, env(ON), gemini(text));
  assert(out.mode === 'llm', 'mode llm');
  assert(out.explanation.startsWith(text) && out.explanation.endsWith('AI recommends; authorised humans decide.'), 'explanation');
  assert(out.recommendation === rules.recommendation && JSON.stringify(out.flags) === JSON.stringify(rules.flags), 'flags/recommendation unchanged');
  assert(out.potential_excess_cents === rules.potential_excess_cents, 'amounts unchanged');
});

Deno.test('GUARDRAIL: any invented number is rejected', async () => {
  const out = await explainWithAI(rules, pipes, env(ON), gemini('The price is 245% above benchmark and the supplier overcharged by R190,000.00 in total.'));
  assert(out === rules, 'falls back to rules');
  assert(rejectReason('Overcharged by R190,000.00 here, please check this one.', {}, '')?.startsWith('invented'), 'reason');
});

Deno.test('GUARDRAIL: accusations are rejected', async () => {
  const out = await explainWithAI(rules, pipes, env(ON), gemini('This looks like fraud by Pipeworks Direct CC; the benchmark is R5,200.00.'));
  assert(out === rules, 'falls back to rules');
});

Deno.test('failures fall back to the rules: HTTP error, bad JSON, empty reply', async () => {
  for (const f of [
    async () => new Response('quota exceeded', { status: 429 }),
    async () => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: 'not json' }] } }] })),
    async () => new Response(JSON.stringify({})),
    async () => { throw new Error('network down'); },
  ]) assert((await explainWithAI(rules, pipes, env(ON), f)) === rules, 'fallback');
});

Deno.test('timeout falls back quickly', async () => {
  const hang = (_u: string, init: RequestInit) => new Promise<Response>((_r, reject) =>
    init.signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))));
  const t = Date.now();
  const out = await explainWithAI(rules, pipes, env({ ...ON, AI_TIMEOUT_MS: '200' }), hang);
  assert(out === rules && Date.now() - t < 2000, 'timed out to rules');
});

Deno.test('the key travels in a header, never the URL; Gemini sees only the rule results', async () => {
  let url = '', init: RequestInit = {};
  await explainWithAI(rules, pipes, env(ON), async (u, i) => { url = u; init = i; return new Response('{}'); });
  assert(!url.includes('test-key') && (init.headers as Record<string, string>)['x-goog-api-key'] === 'test-key', 'header');
  const prompt = JSON.parse(String(init.body)).contents[0].parts[0].text as string;
  assert(prompt.includes('PRICE_ABOVE_BENCHMARK') && prompt.includes('R136,000.00') && prompt.includes('R5,200.00'), 'rule facts in prompt');
});

Deno.test('number normalisation', () => {
  assert(JSON.stringify(numbersIn('R118,400.00 and 131% on 2026-11-18')) === JSON.stringify(['118400', '131', '2026', '11', '18']), 'numbers');
});

const geminiWith = (explanation: string, category_mismatch_lines: unknown) => async () =>
  new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify({ explanation, category_mismatch_lines }) }] } }] }), { status: 200 });

Deno.test('AI concern catches what rules cannot: a bakkie filed under "pipes" is held, not approved', async () => {
  const ctx = DEMO['#3b bakkie as "pipes"'];
  const r = analyse(ctx);
  assert(r.recommendation === 'APPROVE', 'rules alone would approve it (category "pipes" is permitted)');
  const out = await explainWithAI(r, ctx, env(ON), geminiWith('Line 0 describes a 4x4 double-cab bakkie but is declared as pipes, and no reference price matched it. Verify what was actually supplied before paying R785,000.00.', [0]));
  assert(out.recommendation === 'HOLD_FOR_REVIEW', 'escalated to hold');
  assert(out.flags.includes('AI_CATEGORY_CONCERN') && out.checks.some((c) => c.code === 'AI_CATEGORY_CONCERN' && c.severity === 'medium' && c.line === 0), 'concern recorded');
  assert(r.checks.every((c) => out.checks.includes(c)), 'no rule check removed');
});

Deno.test('AI can never soften: HOLD and REJECT stay; bogus line numbers are ignored', async () => {
  const bakkie = DEMO['#3 bakkie'];
  const rej = analyse(bakkie);
  const out = await explainWithAI(rej, bakkie, env(ON), geminiWith('A vehicle on a water project is outside the permitted categories water_storage, pipes and installation.', [0]));
  assert(out.recommendation === 'REJECT', 'reject stays reject');
  const out2 = await explainWithAI(rules, pipes, env(ON), geminiWith('The R12,000.00 unit price is far above the R5,200.00 benchmark.', [7, -1, 'x', 0.5]));
  assert(out2.recommendation === rules.recommendation && !out2.flags.includes('AI_CATEGORY_CONCERN'), 'invalid lines ignored');
});

Deno.test('a rejected reply applies no concern either', async () => {
  const ctx = DEMO['#3b bakkie as "pipes"'];
  const r = analyse(ctx);
  const out = await explainWithAI(r, ctx, env(ON), geminiWith('This is fraud worth R999,999.00.', [0]));
  assert(out === r, 'whole reply discarded');
});

Deno.test('a retired model (404) falls through to the next one in the chain', async () => {
  const tried: string[] = [];
  const f = async (url: string) => {
    tried.push(url.split('/models/')[1].split(':')[0]);
    return tried.length === 1 ? new Response('{}', { status: 404 }) : await gemini('The R12,000.00 unit price is far above the R5,200.00 benchmark.')();
  };
  const out = await explainWithAI(rules, pipes, env(ON), f);
  assert(out.mode === 'llm', 'second model answered');
  assert(JSON.stringify(tried) === JSON.stringify(['gemini-3.8-flash', 'gemini-3.1-flash-lite']), `default chain: 3.8-flash then 3.1-flash-lite, got ${tried}`);
  const custom: string[] = [];
  await explainWithAI(rules, pipes, env({ ...ON, GEMINI_MODEL: 'model-a, model-b' }), async (u: string) => { custom.push(u.split('/models/')[1].split(':')[0]); return new Response('{}', { status: 404 }); });
  assert(JSON.stringify(custom) === JSON.stringify(['model-a', 'model-b']), 'GEMINI_MODEL is a comma list');
});

Deno.test('asks for low thinking; retries without it if a model rejects the setting', async () => {
  const bodies: Record<string, unknown>[] = [];
  const f = async (_u: string, init: RequestInit) => {
    const b = JSON.parse(String(init.body)); bodies.push(b.generationConfig);
    return b.generationConfig.thinkingConfig
      ? new Response(JSON.stringify({ error: { message: 'Unknown name "thinkingLevel" at generation_config.thinking_config' } }), { status: 400 })
      : await gemini('The R12,000.00 unit price is far above the R5,200.00 benchmark.')();
  };
  const out = await explainWithAI(rules, pipes, env(ON), f);
  assert(out.mode === 'llm', 'answered on retry');
  assert((bodies[0] as { thinkingConfig?: { thinkingLevel: string } }).thinkingConfig?.thinkingLevel === 'low' && !('thinkingConfig' in bodies[1]), 'low first, then without');
  const other = await explainWithAI(rules, pipes, env(ON), async () => new Response(JSON.stringify({ error: { message: 'API key not valid' } }), { status: 400 }));
  assert(other === rules, 'other 400s fall back without a retry loop');
});

Deno.test('the prompt asks for plain words, not line numbers or codes', async () => {
  let prompt = '';
  await explainWithAI(rules, pipes, env(ON), async (_u, i) => { prompt = JSON.parse(String(i.body)).contents[0].parts[0].text; return new Response('{}'); });
  assert(prompt.includes('never as "line 0"') && prompt.includes('not codes or field names'), 'wording rules present');
});

Deno.test('an overloaded model (503/429/500) falls through to the next; the last resort is Flash-Lite', async () => {
  for (const status of [503, 429, 500]) {
    const tried: string[] = [];
    const out = await explainWithAI(rules, pipes, env(ON), async (url: string) => {
      tried.push(url.split('/models/')[1].split(':')[0]);
      return tried.length < 2 ? new Response('{"error":{"message":"overloaded"}}', { status }) : await gemini('The R12,000.00 unit price is far above the R5,200.00 benchmark.')();
    });
    assert(out.mode === 'llm' && tried[1] === 'gemini-3.1-flash-lite', `status ${status}: ${tried}`);
  }
  const all = await explainWithAI(rules, pipes, env(ON), async () => new Response('{}', { status: 503 }));
  assert(all === rules, 'every model overloaded → rules');
});

Deno.test('a slow model is cut off at its own limit and the next model still answers', async () => {
  const tried: string[] = [];
  const t = Date.now();
  const out = await explainWithAI(rules, pipes, env({ ...ON, AI_MODEL_TIMEOUT_MS: '300' }), (url: string, init: RequestInit) => {
    tried.push(url.split('/models/')[1].split(':')[0]);
    if (tried.length === 1) {
      return new Promise<Response>((_r, reject) => init.signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))));
    }
    return gemini('The R12,000.00 unit price is far above the R5,200.00 benchmark.')();
  });
  assert(out.mode === 'llm' && tried[1] === 'gemini-3.1-flash-lite', `lite answered: ${tried}`);
  assert(Date.now() - t < 2000, 'did not wait for the slow model');
});

Deno.test('no AI concern on a line the rules already flagged as outside the project purpose', async () => {
  const bakkie = DEMO['#3 bakkie'];
  const r = analyse(bakkie);
  const out = await explainWithAI(r, bakkie, env(ON), geminiWith('A vehicle is outside the permitted water storage, pipes and installation categories.', [0]));
  assert(out.mode === 'llm' && !out.flags.includes('AI_CATEGORY_CONCERN') && out.recommendation === 'REJECT', 'no redundant concern');
});

Deno.test('the prompt separates unit prices from total excess', async () => {
  let prompt = '';
  await explainWithAI(rules, pipes, env(ON), async (_u, i) => { prompt = JSON.parse(String(i.body)).contents[0].parts[0].text; return new Response('{}'); });
  assert(prompt.includes('are TOTALS') && prompt.includes('Never say a unit price exceeds anything by a total amount'), 'unit vs total rule present');
});
