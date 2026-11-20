// Catalogue matching: give each invoice line a reference price when the supplier did not pick one.
//
// The web form does not ask suppliers for a catalogue SKU, so lines arrive with
// reference_sku = null and the price check could never run. Before the rules run, a line
// without a SKU is matched to a reference price only when BOTH hold:
//   1. the catalogue has exactly one item in the line's declared category, and
//   2. the line's description shares a word with that item's description.
// Otherwise the line stays unmatched (NO_BENCHMARK), as before. Rule 2 matters: a
// "4x4 double-cab bakkie" declared as "pipes" is NOT priced as a pipe; it stays unmatched
// and the AI category check can still notice it. A SKU the supplier did give is never changed.
import type { AnalysisContext } from './rules.ts';

type CataloguePrice = { sku: string; category?: string; description?: string };

// Lower-case words of 4+ letters, without a plural "s", cut to 6 letters:
// "Pipes" → "pipe", "installation" / "installed" → "instal". Digits and units are ignored.
const STOP = new Set(['with', 'from', 'each', 'unit', 'supply', 'supplied', 'delivery']);
const stems = (text: string | undefined) => new Set(
  (text ?? '').toLowerCase().match(/[a-z]{4,}/g)?.filter((w) => !STOP.has(w)).map((w) => w.replace(/s$/, '').slice(0, 6)) ?? [],
);

/** Returns the context with inferred reference_sku values; the input is not modified. */
export function withCatalogueMatches(ctx: AnalysisContext): AnalysisContext {
  const prices = (ctx.prices ?? []) as CataloguePrice[];
  const items = ctx.items.map((item) => {
    if (item.reference_sku) return item;
    const inCategory = prices.filter((p) => p.category === item.category);
    if (inCategory.length !== 1) return item;
    const words = stems(item.description);
    const shared = [...stems(inCategory[0].description)].some((w) => words.has(w));
    return shared ? { ...item, reference_sku: inCategory[0].sku } : item;
  });
  return { ...ctx, items };
}
