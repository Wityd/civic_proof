# Frontend integration: Supabase first

Express is replaced. Use Supabase Auth/Data API for RLS-permitted operations and
the Edge router for sensitive actions. Integrate this change on your own branch;
frontend source files are not changed by this backend update.

```text
SUPABASE_URL=https://crshjvjrgnnypxbpjmob.supabase.co
EDGE_BASE=https://crshjvjrgnnypxbpjmob.supabase.co/functions/v1/civicproof-api
```

Use a publishable/anon key in the UI. Never expose a service-role, account access,
signing or AI key in `VITE_*` configuration.

```ts
await supabase.auth.signInWithPassword({ email, password });
const me = await supabase.from('users').select('id,display_name,role').single();
const ownedSuppliers = await supabase.from('suppliers').select('*');
const invoices = await supabase.from('invoices').select('*'); // RLS scoped
const dashboard = await supabase.rpc('get_public_dashboard', {
  p_project_id: null, // UUID for one project, null for list
  p_mode: 'simulated',
});
```

To invoke protected actions:

```ts
async function edge(path: string, body: unknown) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Sign in first');
  const form = body instanceof FormData;
  const res = await fetch(`${EDGE_BASE}${path}`, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${session.access_token}`,
      ...(!form ? { 'Content-Type': 'application/json' } : {}),
    },
    body: form ? body : JSON.stringify(body),
  });
  const result = await res.json();
  if (!res.ok) throw new Error(result.error.message);
  return result.data;
}
```

The Edge Function verifies Auth; the browser session only supplies the token.
Do not manually set multipart Content-Type: the browser creates its boundary.

```ts
const form = new FormData();
form.set('file', pdfFile);
form.set('invoice', JSON.stringify({
  project_id: '10000000-0000-4000-8000-000000000001',
  supplier_id: selectedOwnedSupplierId,
  invoice_number: 'BB-001', invoice_date: '2026-11-18', total_cents: 11840000,
  // milestone_id: optional REGISTERED milestone UUID,
  line_items: [{
    description: '10,000 L tank', category: 'water_storage',
    reference_sku: 'TANK-10000L', quantity: 8,
    unit_price_cents: 1480000, line_total_cents: 11840000,
  }],
}));
const invoice = await edge('/invoices', form);
await edge(`/invoices/${invoice.id}/analyse`, {}); // municipality
await edge(`/invoices/${invoice.id}/approve`, { reason: optionalOverrideReason });
await edge(`/payments/${invoice.id}/execute`, {});
```

Other calls: `/invoices/:id/hold` and `/reject` require `{reason}`;
`/milestones/:id/register` and `/verify` take `{}`;
`/milestones/:id/confirm` takes `{note}` and returns HTTP 201;
`/milestones/:id/evidence` takes multipart `file` and optional `caption`.
Duplicate images return `DUPLICATE_EVIDENCE`. Community confirmation never
unlocks payment; official verification does.

Ordinary direct writes include own profile display name, own supplier contacts,
citizen concerns and community confirmations. Include the signed-in user's ID
for `raised_by`/`actor_id`; RLS rejects impersonation. Do not write invoice status,
trusted roles, AI reviews, transaction records or official verification directly.

For an authorised invoice file use
`supabase.storage.from('invoices').createSignedUrl(invoice.document_path, 60)`.
Ownership/staff RLS applies. Buckets stay private; browser uploads are not granted.

Show **Simulated ledger** for the current mode and no explorer links for `sim_*`
hashes. Live financial writes return `503 CHAIN_NOT_READY` until P3's adapter is
configured. Rules-mode analysis uses submitted manual data; PDF/LLM extraction
is P4's integration boundary. See [BACKEND.md](BACKEND.md) for all implemented routes.
