// Run only against the configured CivicProof demo project. Creates an isolated
// VERIFY project, tests real HTTP boundaries, then removes only its fixtures.
const root = Deno.env.get('TEST_SUPABASE_URL')!;
const anon = Deno.env.get('TEST_SUPABASE_ANON_KEY')!;
const service = Deno.env.get('TEST_SUPABASE_SERVICE_KEY')!;
const management = Deno.env.get('TEST_SUPABASE_ACCESS_TOKEN')!;
const accounts: { role: string; email: string; password: string }[] = JSON.parse(Deno.env.get('TEST_USERS_JSON')!);
const base = `${root}/functions/v1/civicproof-api`;
const run = crypto.randomUUID();
function assert(ok: unknown, message: string): asserts ok { if (!ok) throw new Error(message); }
const sessions: Record<string, { token: string; id: string }> = {};
let project = ''; let orphanSupplier = '';
const headers = (token?: string, key = anon) => ({ apikey: key, ...(token ? { Authorization: `Bearer ${token}` } : {}) });
async function request(path: string, method = 'GET', body?: unknown, role?: string, expected = 200) {
  const token = role ? sessions[role].token : undefined;
  const form = body instanceof FormData;
  const r = await fetch(`${base}${path}`, { method, headers: { ...headers(token), ...(body !== undefined && !form ? { 'Content-Type': 'application/json' } : {}) }, body: body === undefined ? undefined : form ? body : JSON.stringify(body) });
  const result = await r.json();
  assert(r.status === expected, `${method} ${path}: expected ${expected}, got ${r.status} (${result.error?.code || 'response'})`);
  return result.data;
}
async function rest(path: string, method: string, body: unknown, role: string, expected: number) {
  const r = await fetch(`${root}/rest/v1/${path}`, { method, headers: { ...headers(sessions[role].token), 'Content-Type': 'application/json', Prefer: 'return=representation' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const result = await r.json();
  assert(r.status === expected, `${method} REST ${path}: expected ${expected}, got ${r.status}`);
  return result;
}
async function submit(supplier: string, number: string, total: number, category: string, sku: string | null, quantity: number, unit: number, milestone?: string, fileText = number) {
  const form = new FormData();
  form.set('invoice', JSON.stringify({ project_id: project, supplier_id: supplier, invoice_number: `${run}-${number}`, invoice_date: '2026-11-18', total_cents: total, milestone_id: milestone, line_items: [{ description: number, category, reference_sku: sku, quantity, unit_price_cents: unit, line_total_cents: total }] }));
  form.set('file', new File([`%PDF-1.4\nCivicProof verification ${run} ${fileText}\n%%EOF`], 'invoice.pdf', { type: 'application/pdf' }));
  return await request('/invoices', 'POST', form, 'supplier', 201);
}
async function cleanup() {
  if (project) {
    const sh = { apikey: service, Authorization: `Bearer ${service}` };
    const invoices = await (await fetch(`${root}/rest/v1/invoices?project_id=eq.${project}&select=document_path`, { headers: sh })).json();
    const milestones = await (await fetch(`${root}/rest/v1/milestones?project_id=eq.${project}&select=id`, { headers: sh })).json();
    const evidence = milestones.length ? await (await fetch(`${root}/rest/v1/evidence?milestone_id=in.(${milestones.map((m: { id: string }) => m.id).join(',')})&select=object_path`, { headers: sh })).json() : [];
    for (const [bucket, paths] of [['invoices', invoices.map((i: { document_path: string }) => i.document_path)], ['evidence', evidence.map((e: { object_path: string }) => e.object_path)]] as [string, string[]][]) {
      if (paths.length) { const removed = await fetch(`${root}/storage/v1/object/${bucket}`, { method: 'DELETE', headers: { ...sh, 'Content-Type': 'application/json' }, body: JSON.stringify({ prefixes: paths }) }); await removed.arrayBuffer(); assert(removed.ok, 'Temporary files must be removed.'); }
    }
    assert(/^[0-9a-f-]{36}$/.test(project), 'Cleanup UUID validation');
    const sql = `begin;
      delete from public.approvals where invoice_id in(select id from public.invoices where project_id='${project}');
      delete from public.ai_reviews where invoice_id in(select id from public.invoices where project_id='${project}');
      delete from public.invoice_items where invoice_id in(select id from public.invoices where project_id='${project}');
      delete from public.transactions where project_id='${project}';
      delete from public.invoices where project_id='${project}';
      delete from public.verifications where milestone_id in(select id from public.milestones where project_id='${project}');
      delete from public.evidence where milestone_id in(select id from public.milestones where project_id='${project}');
      delete from public.concerns where project_id='${project}';
      delete from public.milestones where project_id='${project}';
      delete from public.project_wallets where project_id='${project}';
      delete from public.projects where id='${project}';
      ${orphanSupplier && /^[0-9a-f-]{36}$/.test(orphanSupplier) ? `delete from public.suppliers where id='${orphanSupplier}';` : ''}
      commit;`;
    const removed = await fetch('https://api.supabase.com/v1/projects/crshjvjrgnnypxbpjmob/database/query', { method: 'POST', headers: { Authorization: `Bearer ${management}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ query: sql }) });
    await removed.arrayBuffer(); assert(removed.ok, 'Temporary database fixtures must be removed.');
  }
  for (const session of Object.values(sessions)) { const r = await fetch(`${root}/auth/v1/logout?scope=local`, { method: 'POST', headers: headers(session.token) }); await r.arrayBuffer(); }
}

Deno.test({ name: 'live Supabase-first access controls and complete simulated money flow', sanitizeResources: false, sanitizeOps: false, fn: async () => {
  try {
    assert((await request('/health')).status === 'ok', 'Public health check');
    await request('/me', 'GET', undefined, undefined, 401);
    const invalid = await fetch(`${base}/me`, { headers: headers('forged.invalid.token') }); await invalid.arrayBuffer(); assert(invalid.status === 401, 'Forged JWT rejected');
    for (const account of accounts) {
      const r = await fetch(`${root}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { apikey: anon, 'Content-Type': 'application/json' }, body: JSON.stringify({ email: account.email, password: account.password }) });
      const s = await r.json(); assert(r.ok && s.access_token, `${account.role} login`); sessions[account.role] = { token: s.access_token, id: s.user.id };
      const me = await request('/me', 'GET', undefined, account.role);
      assert(me.role === account.role, 'Trusted role from database');
      const owned = await rest(`suppliers?user_id=eq.${s.user.id}&select=id,name&order=name.asc,id.asc`, 'GET', undefined, account.role, 200);
      assert(me.suppliers.length === owned.length && me.suppliers.every((v: { id: string; name: string }, i: number) => v.id === owned[i].id && v.name === owned[i].name), 'Me lists only owned suppliers');
      assert(JSON.stringify(me.supplier_ids) === JSON.stringify(owned.map((v: { id: string }) => v.id)), 'Supplier IDs match owned records');
      const profiles = await rest('users?select=id,role', 'GET', undefined, account.role, 200); assert(profiles.length === 1 && profiles[0].id === s.user.id, 'Only own profile visible');
      await rest(`users?id=eq.${s.user.id}`, 'PATCH', { role: 'municipality' }, account.role, 403);
      await rest('transactions', 'POST', { mode: 'simulated' }, account.role, 403);
      await rest('rpc/cp_execute_payment', 'POST', { p_actor: sessions[account.role].id, p_invoice_id: '10000000-0000-4000-8000-000000000001' }, account.role, 403);
    }
    console.log('PASS Auth, own-profile RLS, role-escalation and privileged RPC denial');
    const publicProjects = await request('/projects'); assert(publicProjects.some((p: { code: string }) => p.code === 'CP001'), 'Public dashboard reads CP001');
    const created = await request('/projects', 'POST', { code: `VERIFY-${run}`, name: 'Temporary verification project', budget_cents: 200000000, permitted_categories: ['water_storage','pipes','installation'] }, 'municipality', 201); project = created.id;
    const m = await request(`/projects/${project}/milestones`, 'POST', { code: 'M1', title: 'Temporary delivery milestone' }, 'municipality', 201);
    await request(`/milestones/${m.id}/register`, 'POST', {}, 'municipality');
    const supplierList = await request('/suppliers');
    const tanks = supplierList.find((s: { name: string }) => s.name.startsWith('Blue Basin')).id;
    const pipes = supplierList.find((s: { name: string }) => s.name.startsWith('Pipeworks')).id;
    const motors = supplierList.find((s: { name: string }) => s.name.startsWith('Summit')).id;
    const suppliers = await request('/suppliers', 'POST', { name: 'Unassigned test supplier', registration_no: run, registered_on: '2015-01-01' }, 'municipality', 201); orphanSupplier = suppliers.id;
    // Ordinary citizen writes are direct Supabase operations, scoped to that citizen.
    const concerns = await rest('concerns', 'POST', { project_id: project, raised_by: sessions.citizen.id, message: 'Temporary concern' }, 'citizen', 201);
    await rest('concerns', 'POST', { project_id: project, raised_by: sessions.municipality.id, message: 'Forged actor' }, 'citizen', 403);
    await request(`/concerns/${concerns[0].id}/respond`, 'POST', { response: 'Temporary response' }, 'municipality');
    await rest('verifications', 'POST', { milestone_id: m.id, actor_id: sessions.citizen.id, kind: 'official', note: 'Forged official' }, 'citizen', 403);
    console.log('PASS public reads and citizen RLS writes; impersonation and official-verification forgery blocked');

    const fair = await submit(tanks, 'FAIR', 11840000, 'water_storage', 'TANK-10000L', 8, 1480000);
    for (const role of ['supplier','auditor','citizen']) {
      const download = await fetch(`${root}/storage/v1/object/authenticated/invoices/${fair.document_path}`, { headers: headers(sessions[role].token) });
      await download.arrayBuffer();
      assert(role === 'citizen' ? [400,403,404].includes(download.status) : download.status === 200, `${role} invoice-file access`);
    }
    await rest(`invoices?id=eq.${fair.id}`, 'PATCH', { status: 'paid' }, 'supplier', 403);
    assert((await rest(`invoices?id=eq.${fair.id}&select=id`, 'GET', undefined, 'citizen', 200)).length === 0, 'Citizen cannot read private invoice');
    await request(`/invoices/${fair.id}/approve`, 'POST', {}, 'supplier', 403);
    const analysis = await request(`/invoices/${fair.id}/analyse`, 'POST', {}, 'municipality'); assert(analysis.recommendation === 'APPROVE', 'Fair invoice recommends approval');
    await request(`/invoices/${fair.id}/approve`, 'POST', {}, 'municipality');
    const paid = await Promise.all([request(`/payments/${fair.id}/execute`, 'POST', {}, 'municipality'), request(`/payments/${fair.id}/execute`, 'POST', {}, 'municipality')]);
    assert(paid[0].id === paid[1].id, 'Concurrent execution returns the same release');
    assert((await request(`/projects/${project}/wallet`)).balance_cents === 188160000, 'Balance after fair invoice');

    const inflated = await submit(pipes, 'PIPE', 24000000, 'pipes', 'PIPE-HDPE-250-12', 20, 1200000);
    const check = await request(`/invoices/${inflated.id}/analyse`, 'POST', {}, 'municipality'); assert(check.recommendation === 'HOLD_FOR_REVIEW' && check.potential_excess_cents === 13600000, 'Inflated invoice detection');
    await request(`/invoices/${inflated.id}/approve`, 'POST', {}, 'municipality', 400);
    await request(`/invoices/${inflated.id}/hold`, 'POST', { reason: 'Price review needed' }, 'municipality');
    await request(`/payments/${inflated.id}/execute`, 'POST', {}, 'municipality', 409);
    const wrong = await submit(motors, 'VEHICLE', 78500000, 'vehicles', null, 1, 78500000);
    assert((await request(`/invoices/${wrong.id}/analyse`, 'POST', {}, 'municipality')).recommendation === 'REJECT', 'Wrong purpose rejected');
    await request(`/invoices/${wrong.id}/reject`, 'POST', { reason: 'Outside project purpose' }, 'municipality');
    console.log('PASS PDF submission, fair/overpriced/wrong-purpose analysis, review rules and concurrent idempotent payment');

    const installation = await submit(tanks, 'INSTALL', 6400000, 'installation', 'INSTALL-TANK', 8, 800000, m.id);
    await request(`/invoices/${installation.id}/analyse`, 'POST', {}, 'municipality'); await request(`/invoices/${installation.id}/approve`, 'POST', {}, 'municipality');
    await request(`/payments/${installation.id}/execute`, 'POST', {}, 'municipality', 409);
    const image = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aT1kAAAAASUVORK5CYII='), (v) => v.charCodeAt(0));
    for (let i = 0; i < 2; i++) { const f = new FormData(); f.set('file', new File([image], 'photo.png', { type: 'image/png' })); const e = await request(`/milestones/${m.id}/evidence`, 'POST', f, 'citizen', 201); if (i) assert(e.flags.includes('DUPLICATE_EVIDENCE'), 'Duplicate photo detected'); }
    await request(`/milestones/${m.id}/confirm`, 'POST', { note: 'Community evidence' }, 'citizen', 201);
    await request(`/payments/${installation.id}/execute`, 'POST', {}, 'municipality', 409);
    await request(`/milestones/${m.id}/verify`, 'POST', {}, 'auditor'); await request(`/payments/${installation.id}/execute`, 'POST', {}, 'municipality');
    assert((await request(`/projects/${project}/wallet`)).balance_cents === 181760000, 'Final demo balance R1,817,600');
    const dashboard = await request(`/projects/${project}`);
    assert(dashboard.milestones.some((v: {id:string;status:string}) => v.id===m.id && v.status==='verified'), 'Project embeds current milestone fields');
    const audited = await request(`/invoices/${fair.id}`, 'GET', undefined, 'auditor');
    assert(audited.approvals[0].actor_display_name, 'Auditor sees approver display name');
    const serial = JSON.stringify(dashboard); for (const secret of ['document_path','document_sha256','contact_email','contact_phone','submitted_by']) assert(!serial.includes(`"${secret}"`), 'Public data is redacted');
    console.log('PASS delivery gating, duplicate evidence, community vs official verification, redaction and expected final balance');

    const filtered = await request(`/invoices?project_id=${project}&status=paid,on_hold`, 'GET', undefined, 'municipality');
    assert(filtered.length === 3 && filtered.every((i: { status: string }) => ['paid','on_hold'].includes(i.status)), 'Status lists include both paid invoices and the held invoice, excluding rejected');
    await request('/invoices?status=paid,unknown', 'GET', undefined, 'municipality', 400);
    await request('/invoices?status=paid,', 'GET', undefined, 'municipality', 400);

    const hugeA = await submit(tanks, 'RESERVE-A', 150000000, 'water_storage', 'TANK-10000L', 1, 150000000);
    const hugeB = await submit(tanks, 'RESERVE-B', 150000000, 'water_storage', 'TANK-10000L', 1, 150000000);
    await request(`/invoices/${hugeA.id}/analyse`, 'POST', {}, 'municipality'); await request(`/invoices/${hugeB.id}/analyse`, 'POST', {}, 'municipality');
    const reserve = await Promise.all([hugeA, hugeB].map((i) => fetch(`${base}/invoices/${i.id}/approve`, { method: 'POST', headers: { ...headers(sessions.municipality.token), 'Content-Type': 'application/json' }, body: JSON.stringify({ reason: 'Temporary concurrency check' }) })));
    const statuses = reserve.map((r) => r.status).sort(); for (const r of reserve) await r.arrayBuffer(); assert(statuses[0] === 200 && statuses[1] === 409, 'Concurrent approvals cannot overspend available funds');
    await request('/chain/reconcile', 'POST', {}, 'citizen', 403);
    const reconciliation = await request('/chain/reconcile', 'POST', {}, 'municipality');
    assert(reconciliation.checked === 0, 'No chain transactions need reconciliation during simulated checks');
    console.log('PASS concurrent budget reservation and role-protected chain reconciliation');
  } finally { await cleanup(); }
} });
