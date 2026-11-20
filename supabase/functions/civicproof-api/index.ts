import { analyse, type AnalysisContext } from '../_shared/rules.ts';
import { chainDecide, chainExecutePayment, chainHttpStatus, chainMilestone, chainReconcile, chainStatus, chainSubmitInvoice, type ChainDeps } from '../_shared/chain_routes.ts';

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS' };
class ApiError extends Error { constructor(public code: string, message: string, public status = 400) { super(message); } }
const url = Deno.env.get('SUPABASE_URL')!;
const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const response = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { ...cors, 'Content-Type': 'application/json' } });

async function db(path: string, method = 'GET', body?: unknown, token?: string) {
  const r = await fetch(`${url}/rest/v1/${path}`, { method, headers: { apikey: token ? anonKey : serviceKey, Authorization: `Bearer ${token || serviceKey}`, 'Content-Type': 'application/json', Prefer: 'return=representation' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const result = await r.json();
  if (!r.ok) {
    const message = String(result.message || '');
    const code = message.split(':')[0];
    const statuses: Record<string, number> = { FORBIDDEN: 403, NOT_FOUND: 404, VALIDATION: 400, INVALID_STATE: 409, REASON_REQUIRED: 400, BUDGET_EXCEEDED: 409, MILESTONE_NOT_VERIFIED: 409, CHAIN_NOT_READY: 503 };
    if (statuses[code]) throw new ApiError(code, message.slice(code.length + 1).trim(), statuses[code]);
    if (result.code === '23505') throw new ApiError('CONFLICT', 'This record already exists.', 409);
    if (['23502', '23503', '23514', '22P02', '22007', '22003'].includes(result.code)) throw new ApiError('VALIDATION', 'Invalid fields or linked record.');
    if (result.code === '42501') throw new ApiError('FORBIDDEN', 'This action is not permitted.', 403);
    throw new ApiError('DATABASE_ERROR', 'The operation could not be completed.', 500);
  }
  return result;
}
const rpc = (name: string, args: unknown) => db(`rpc/${name}`, 'POST', args);
// P3 chain mode (fuji | bsc): prepare → chain → settle. Simulated mode never uses this.
const chainDeps: ChainDeps = { rpc: (name, args) => rpc(name, args), fail: (code, message, status) => new ApiError(code, message, status) };
const readMode = async (requested: string | null) => requested || String(await rpc('cp_wallet_mode', {}));

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ApiError('VALIDATION', 'A JSON object is required.');
  return value as Record<string, unknown>;
}
function text(value: unknown, max = 200, required = true): string {
  if ((!required && value == null) || (!required && value === '')) return '';
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new ApiError('VALIDATION', `A text field of 1-${max} characters is required.`);
  return value.trim();
}
function uuid(value: unknown): string {
  if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) throw new ApiError('VALIDATION', 'A valid UUID is required.');
  return value.toLowerCase();
}
function cents(value: unknown, positive = false): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < (positive ? 1 : 0) || value > 1_000_000_000_000) throw new ApiError('VALIDATION', 'Money must be integer cents within the supported range.');
  return value;
}
function date(value: unknown): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value) throw new ApiError('VALIDATION', 'A valid YYYY-MM-DD date is required.');
  return value;
}
async function bytes(req: Request, limit: number): Promise<Uint8Array<ArrayBuffer>> {
  if (Number(req.headers.get('content-length') || 0) > limit) throw new ApiError('FILE_TOO_LARGE', 'Request is too large.', 413);
  const reader = req.body?.getReader();
  if (!reader) throw new ApiError('VALIDATION', 'Request body is required.');
  const parts: Uint8Array[] = []; let total = 0;
  try {
    while (true) { const { done, value } = await reader.read(); if (done) break; total += value.length; if (total > limit) { await reader.cancel(); throw new ApiError('FILE_TOO_LARGE', 'Request is too large.', 413); } parts.push(value); }
  } finally { reader.releaseLock(); }
  const result = new Uint8Array(total); let offset = 0;
  for (const part of parts) { result.set(part, offset); offset += part.length; }
  return result;
}
async function json(req: Request) {
  try { return record(JSON.parse(new TextDecoder().decode(await bytes(req, 262144)))); }
  catch (e) { if (e instanceof ApiError) throw e; throw new ApiError('VALIDATION', 'Invalid JSON.'); }
}
async function multipart(req: Request) {
  if (!req.headers.get('content-type')?.startsWith('multipart/form-data;')) throw new ApiError('VALIDATION', 'Use multipart/form-data.');
  try { return await new Response(await bytes(req, 11 * 1024 * 1024), { headers: { 'content-type': req.headers.get('content-type')! } }).formData(); }
  catch (e) { if (e instanceof ApiError) throw e; throw new ApiError('VALIDATION', 'Invalid multipart data.'); }
}
async function upload(file: FormDataEntryValue | null, actor: string, kind: 'invoices' | 'evidence') {
  if (!(file instanceof File) || file.size === 0 || file.size > 10 * 1024 * 1024) throw new ApiError('VALIDATION', 'A file of 1 byte to 10 MiB is required.');
  const buffer = new Uint8Array(await file.arrayBuffer());
  const start = new TextDecoder().decode(buffer.slice(0, 16));
  const isPdf = start.startsWith('%PDF-');
  const isPng = [137,80,78,71,13,10,26,10].every((b,i) => buffer[i] === b);
  const isJpeg = buffer[0] === 255 && buffer[1] === 216 && buffer[2] === 255;
  const isWebp = start.startsWith('RIFF') && start.slice(8,12) === 'WEBP';
  const mime = kind === 'invoices' && isPdf ? 'application/pdf' : kind === 'evidence' && isPng ? 'image/png' : kind === 'evidence' && isJpeg ? 'image/jpeg' : kind === 'evidence' && isWebp ? 'image/webp' : null;
  if (!mime) throw new ApiError('VALIDATION', kind === 'invoices' ? 'A PDF is required.' : 'JPEG, PNG or WebP evidence is required.');
  const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', buffer))].map((v) => v.toString(16).padStart(2, '0')).join('');
  const ext = { 'application/pdf': 'pdf', 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' }[mime];
  const path = `${actor}/${crypto.randomUUID()}.${ext}`;
  const r = await fetch(`${url}/storage/v1/object/${kind}/${path}`, { method: 'POST', headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, 'Content-Type': mime, 'x-upsert': 'false' }, body: buffer });
  if (!r.ok) throw new ApiError('STORAGE_ERROR', 'The file could not be stored.', 502);
  return { path, hash, remove: () => fetch(`${url}/storage/v1/object/${kind}`, { method: 'DELETE', headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ prefixes: [path] }) }) };
}

async function handle(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  try {
    const requestUrl = new URL(req.url);
    const path = requestUrl.pathname.replace(/^.*\/civicproof-api\/?/, '/').replace(/\/$/, '') || '/';
    if (req.method === 'GET' && path === '/health') return response({ data: { status: 'ok', architecture: 'supabase-first' } });
    if (req.method === 'GET' && path === '/projects') return response({ data: await rpc('get_public_dashboard', { p_project_id: null, p_mode: await readMode(requestUrl.searchParams.get('mode')) }) });
    const publicProject = path.match(/^\/projects\/([^/]+)(?:\/(wallet|transactions))?$/);
    if (req.method === 'GET' && publicProject) {
      const rows = await rpc('get_public_dashboard', { p_project_id: uuid(publicProject[1]), p_mode: await readMode(requestUrl.searchParams.get('mode')) });
      const project = rows[0]; if (!project) throw new ApiError('NOT_FOUND', 'Project not found.', 404);
      return response({ data: publicProject[2] === 'transactions' ? project.transactions : publicProject[2] === 'wallet' ? { balance_cents: project.balance_cents, available_cents: project.available_cents, paid_cents: project.paid_cents, mode: project.mode, wallet_address: project.wallet_address } : project });
    }
    if (req.method === 'GET' && /^\/suppliers(?:\/[^/]+)?$/.test(path)) {
      const id = path.split('/')[2];
      const data = await db(`suppliers?select=id,name,registration_no,registered_on,verified${id ? `&id=eq.${uuid(id)}` : ''}`);
      if (id && !data[0]) throw new ApiError('NOT_FOUND', 'Supplier not found.', 404);
      return response({ data: id ? data[0] : data });
    }

    // Every sensitive route validates the user with Auth; no JWT payload is trusted.
    const token = req.headers.get('authorization')?.match(/^Bearer\s+(.+)$/i)?.[1];
    if (!token) throw new ApiError('UNAUTHENTICATED', 'Sign in first.', 401);
    const authResponse = await fetch(`${url}/auth/v1/user`, { headers: { apikey: anonKey, Authorization: `Bearer ${token}` } });
    if (!authResponse.ok) throw new ApiError('UNAUTHENTICATED', 'Session is invalid or expired.', 401);
    const user = await authResponse.json(); const actor = uuid(user.id);
    const context = await rpc('cp_context', { p_actor: actor });
    const requireRole = (...roles: string[]) => { if (!roles.includes(context.role)) throw new ApiError('FORBIDDEN', 'Your role cannot perform this action.', 403); };
    if(req.method==='GET' && path==='/chain/status') {
      requireRole('municipality','auditor');
      const mode=requestUrl.searchParams.get('mode') || 'fuji';
      if(mode!=='fuji' && mode!=='bsc') throw new ApiError('VALIDATION','Select fuji or bsc.');
      const project=uuid(requestUrl.searchParams.get('project_id'));
      const wallets=await db(`project_wallets?project_id=eq.${project}&mode=eq.${mode}&select=wallet_address`);
      if(!wallets[0]) throw new ApiError('CHAIN_NOT_READY','No project wallet is registered for this chain.',503);
      return response({data:await chainStatus(chainDeps,mode,wallets[0].wallet_address,project)});
    }
    if (req.method === 'GET' && path === '/me') {
      const rows = await db(`users?id=eq.${actor}&select=id,display_name,role`, 'GET', undefined, token);
      const suppliers = await db(`suppliers?user_id=eq.${actor}&select=id,name&order=name.asc,id.asc`, 'GET', undefined, token);
      return response({ data: { ...rows[0], wallet_mode: context.mode, supplier_ids: suppliers.map((s: { id: string }) => s.id), suppliers } });
    }
    if (req.method === 'GET' && path === '/invoices') {
      requireRole('supplier', 'municipality', 'auditor');
      const project = requestUrl.searchParams.get('project_id'); const status = requestUrl.searchParams.get('status');
      const statuses = status === null ? [] : [...new Set(status.split(',').map((s) => s.trim()))];
      if (statuses.some((s) => !['submitted','analysed','approved','on_hold','rejected','payment_pending','paid','payment_failed'].includes(s))) throw new ApiError('VALIDATION', 'Invalid invoice status.');
      return response({ data: await db(`invoices?select=*&order=created_at.desc${project ? `&project_id=eq.${uuid(project)}` : ''}${statuses.length ? `&status=in.(${statuses.join(',')})` : ''}`, 'GET', undefined, token) });
    }
    const invoiceRoute = path.match(/^\/invoices\/([^/]+)(?:\/(analyse|approve|hold|reject))?$/);
    if (invoiceRoute && req.method === 'GET' && !invoiceRoute[2]) {
      const rows = await db(`invoices?id=eq.${uuid(invoiceRoute[1])}&select=*,items:invoice_items(*),ai_reviews(*),approvals(*),transactions(*)`, 'GET', undefined, token);
      if (!rows[0]) throw new ApiError('NOT_FOUND', 'Invoice not found.', 404);
      const approvals = await rpc('cp_invoice_approvals', { p_actor: actor, p_invoice_id: rows[0].id });
      return response({ data: { ...rows[0], approvals } });
    }
    if (req.method !== 'POST') throw new ApiError('NOT_FOUND', 'Route not found.', 404);

    if (path === '/invoices') {
      requireRole('supplier');
      const form = await multipart(req); let input;
      try { input = record(JSON.parse(String(form.get('invoice') || ''))); } catch { throw new ApiError('VALIDATION', 'The invoice form field must contain JSON.'); }
      if (!Array.isArray(input.line_items) || !input.line_items.length || input.line_items.length > 100) throw new ApiError('VALIDATION', 'Provide 1-100 line items.');
      const items = input.line_items.map((v) => { const i = record(v); const q = i.quantity; if (typeof q !== 'number' || !Number.isFinite(q) || q <= 0 || q > 1e6 || Math.abs(q * 10000 - Math.round(q * 10000)) > 1e-5) throw new ApiError('VALIDATION', 'Quantity requires a positive number with up to four decimals.'); return { description: text(i.description, 1000), category: text(i.category), reference_sku: i.reference_sku ? text(i.reference_sku) : null, quantity: q, unit_price_cents: cents(i.unit_price_cents), line_total_cents: cents(i.line_total_cents) }; });
      const inv = { id: crypto.randomUUID(), project_id: uuid(input.project_id), supplier_id: uuid(input.supplier_id), milestone_id: input.milestone_id ? uuid(input.milestone_id) : null, invoice_number: text(input.invoice_number), invoice_date: date(input.invoice_date), total_cents: cents(input.total_cents, true) };
      const file = await upload(form.get('file'), actor, 'invoices');
      try {
        if (context.mode !== 'simulated') {
          const data = await chainSubmitInvoice(chainDeps, actor, { ...inv, document_path: file.path, document_sha256: file.hash }, items);
          return response({ data }, chainHttpStatus(data, 201));
        }
        return response({ data: await rpc('cp_submit_invoice', { p_actor: actor, p_invoice: { ...inv, document_path: file.path, document_sha256: file.hash }, p_items: items }) }, 201);
      }
      catch (e) {
        // A response can be lost after the invoice committed or the chain sent.
        // Delete only when the database confirms there is no owning invoice.
        try {
          const persisted = await db(`invoices?id=eq.${inv.id}&select=id`);
          if (!persisted.length) await file.remove();
        } catch { /* Keep the PDF while the commit outcome is unknown. */ }
        throw e;
      }
    }
    if (invoiceRoute?.[2]) {
      requireRole('municipality'); const id = uuid(invoiceRoute[1]);
      if (invoiceRoute[2] === 'analyse') {
        const input = await rpc('cp_analysis_context', { p_actor: actor, p_invoice_id: id }) as AnalysisContext;
        return response({ data: await rpc('cp_store_analysis', { p_actor: actor, p_invoice_id: id, p_review: analyse(input) }) });
      }
      const body = await json(req);
      if (context.mode !== 'simulated') {
        const data = await chainDecide(chainDeps, actor, id, invoiceRoute[2] as 'approve' | 'hold' | 'reject', text(body.reason, 4000, false) || null);
        return response({ data }, chainHttpStatus(data));
      }
      return response({ data: await rpc('cp_decide', { p_actor: actor, p_invoice_id: id, p_decision: invoiceRoute[2], p_reason: text(body.reason, 4000, false) || null }) });
    }
    const payment = path.match(/^\/payments\/([^/]+)\/execute$/);
    if (payment) {
      requireRole('municipality');
      if (context.mode !== 'simulated') { const data = await chainExecutePayment(chainDeps, actor, uuid(payment[1])); return response({ data }, chainHttpStatus(data)); }
      return response({ data: await rpc('cp_execute_payment', { p_actor: actor, p_invoice_id: uuid(payment[1]) }) });
    }
    const milestone = path.match(/^\/milestones\/([^/]+)\/(register|verify|confirm|evidence)$/);
    if (milestone) {
      const id = uuid(milestone[1]);
      if (['register', 'verify'].includes(milestone[2])) {
        requireRole(...(milestone[2] === 'register' ? ['municipality'] : ['municipality','auditor']));
        if (context.mode !== 'simulated') { const data = await chainMilestone(chainDeps, actor, id, milestone[2] as 'register' | 'verify'); return response({ data }, chainHttpStatus(data)); }
        return response({ data: await rpc('cp_milestone', { p_actor: actor, p_milestone: id, p_action: milestone[2] }) });
      }
      if (milestone[2] === 'confirm') {
        requireRole('citizen'); const body = await json(req);
        const answer = body.answer ?? null;
        if (answer !== null && !['yes','no','not_sure'].includes(answer as string)) throw new ApiError('VALIDATION', 'Answer must be yes, no or not_sure.');
        return response({ data: await db('verifications', 'POST', { milestone_id: id, actor_id: actor, kind: 'community', answer, note: text(body.note, 4000, false) }, token) }, 201);
      }
      requireRole('supplier', 'citizen'); const form = await multipart(req);
      const file = await upload(form.get('file'), actor, 'evidence');
      try { return response({ data: await rpc('cp_add_evidence', { p_actor: actor, p_milestone: id, p_path: file.path, p_hash: file.hash, p_caption: text(form.get('caption'), 4000, false) }) }, 201); }
      catch (e) { await file.remove(); throw e; }
    }
    if (path === '/projects') {
      requireRole('municipality'); const body = await json(req);
      if (!Array.isArray(body.permitted_categories) || !body.permitted_categories.length || body.permitted_categories.length > 30) throw new ApiError('VALIDATION', 'Project categories are required.');
      return response({ data: await rpc('cp_create_project', { p_actor: actor, p_project: { code: text(body.code), name: text(body.name), description: text(body.description, 4000, false), location: text(body.location, 400, false), budget_cents: cents(body.budget_cents, true), permitted_categories: body.permitted_categories.map((v) => text(v)) } }) }, 201);
    }
    if (path === '/suppliers') {
      requireRole('municipality'); const body = await json(req);
      const linkedUser = body.user_id ? uuid(body.user_id) : null;
      if (linkedUser) { const rows = await db(`users?id=eq.${linkedUser}&role=eq.supplier&select=id`); if (!rows.length) throw new ApiError('VALIDATION', 'Link a supplier-role user.'); }
      return response({ data: (await db('suppliers', 'POST', { name: text(body.name), registration_no: text(body.registration_no), registered_on: date(body.registered_on), verified: false, user_id: linkedUser }))[0] }, 201);
    }
    const newMilestone = path.match(/^\/projects\/([^/]+)\/milestones$/);
    if (newMilestone) {
      requireRole('municipality'); const body = await json(req);
      return response({ data: (await db('milestones', 'POST', { project_id: uuid(newMilestone[1]), code: text(body.code), title: text(body.title), description: text(body.description, 4000, false) }))[0] }, 201);
    }
    const concern = path.match(/^\/projects\/([^/]+)\/concerns$/);
    if (concern) { requireRole('citizen'); const body = await json(req); return response({ data: await db('concerns', 'POST', { project_id: uuid(concern[1]), raised_by: actor, message: text(body.message, 4000) }, token) }, 201); }
    const respond = path.match(/^\/concerns\/([^/]+)\/respond$/);
    if (respond) { requireRole('municipality'); const body = await json(req); return response({ data: await rpc('cp_respond_concern', { p_actor: actor, p_concern: uuid(respond[1]), p_response: text(body.response, 4000) }) }); }
    if (path === '/chain/reconcile') { requireRole('municipality','auditor'); return response({ data: await chainReconcile(chainDeps) }); }
    if (path.startsWith('/chain/')) { requireRole('municipality','auditor'); throw new ApiError('NOT_FOUND', 'Unknown chain route. Use POST /chain/reconcile.', 404); }
    throw new ApiError('NOT_FOUND', 'Route not found.', 404);
  } catch (e) {
    const error = e instanceof ApiError ? e : new ApiError('INTERNAL_ERROR', 'The operation could not be completed.', 500);
    return response({ error: { code: error.code, message: error.message } }, error.status);
  }
}

Deno.serve(handle);
