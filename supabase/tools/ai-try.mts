// Try the Gemini explanation step on the CP001 demo invoices, locally, with YOUR key.
// Nothing is stored and no invoice is touched: it runs the same code civicproof-api uses.
//
//   1. Put GEMINI_API_KEY=AIza... in contracts/.env (git-ignored; never commit it)
//   2. From the repo root:   node supabase/tools/ai-try.mts
//      (Node 22 needs:       node --experimental-strip-types supabase/tools/ai-try.mts)
import { explainWithAI } from '../functions/_shared/ai.ts';
import { DEMO } from '../functions/_shared/demo_contexts.ts';
import { analyse } from '../functions/_shared/rules.ts';

try { process.loadEnvFile('contracts/.env'); } catch { /* fall back to the shell environment */ }
const key = process.env.GEMINI_API_KEY;
if (!key) {
  console.error('✗ No GEMINI_API_KEY. Add it to contracts/.env (from https://aistudio.google.com/apikey), then run this again.');
  process.exit(1);
}
const env = { get: (k: string) => ({ AI_MODE: 'llm', GEMINI_API_KEY: key, GEMINI_MODEL: process.env.GEMINI_MODEL } as Record<string, string | undefined>)[k] };

let ai = 0;
for (const [name, ctx] of Object.entries(DEMO)) {
  const rules = analyse(ctx);
  const t = Date.now();
  const out = await explainWithAI(rules, ctx, env);
  if (out.mode === 'llm') ai++;
  console.log(`\n━━ ${name} · rules recommend ${rules.recommendation} · flags: ${rules.flags.join(', ') || 'none'}`);
  console.log(`   ${out.mode === 'llm' ? `🤖 Gemini (${Date.now() - t} ms)` : '📏 rules fallback (see warning above)'}:`);
  console.log(`   ${out.explanation}`);
  const raised = out.recommendation !== rules.recommendation ? `  (raised from ${rules.recommendation} by an AI concern)` : out.flags.includes('AI_CATEGORY_CONCERN') ? '  (AI concern noted)' : '';
  console.log(`   → final recommendation: ${out.recommendation}${raised}`);
}
console.log(`\n${ai}/${Object.keys(DEMO).length} explanations from Gemini. ${ai ? '✓ Your key works.' : '✗ None: check the warnings above (key, model name, network).'}`);
