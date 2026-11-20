# CivicProof Supabase — P2's current handoff

Updated 20 November 2026. Owner: Mzoo (P2). Code branch: `p2/backend`.
This describes the deployed backend, including the changes in `0240e18`.
Those changes are live even though the older document/code on `main` may differ.
Nothing in this handoff requires merging branches.

## How we are building this

We set up Supabase first, then connect the UI to what is already there.
Supabase handles sign-in, the database, access policies and file storage.
We do not run Express.

The frontend uses Supabase JS for login and permitted database reads/writes.
For invoices, approvals, payments and validated uploads, it calls our deployed
`civicproof-api` Edge Function. The function checks the real login and database
role, applies the rules, and calls Supabase or the blockchain.

```text
UI -> Supabase Auth                 sign in and get a user token
UI -> Supabase JS + RLS              permitted reads and ordinary writes
UI -> civicproof-api                 protected workflows and uploads
civicproof-api -> Postgres RPCs      atomic rules and financial records
civicproof-api -> Fuji contracts     sign, submit and check chain receipts
```

RLS means the database checks which rows that user can read or change.
Changing the UI's "View as" selection alone does not grant another role.

## Connection and demo accounts

```dotenv
VITE_SUPABASE_URL=https://crshjvjrgnnypxbpjmob.supabase.co
VITE_SUPABASE_ANON_KEY=<the project's anon/public key>
VITE_API_URL=https://crshjvjrgnnypxbpjmob.supabase.co/functions/v1/civicproof-api
VITE_USE_MOCKS=false
```

The project URL is the Supabase URL. The Edge URL includes the function path.
The anon/public key can be used in the browser. An account access token,
service-role key, deployer private key and AI keys belong on the server.

| Role | Demo email | What they do |
| --- | --- | --- |
| Citizen | `citizen@demo.civicproof.test` | Public dashboard, concerns, photo evidence and community confirmations |
| Supplier | `supplier@demo.civicproof.test` | Submit PDFs and view invoices for their owned suppliers |
| Municipality | `municipality@demo.civicproof.test` | Analyse invoices, approve/hold/reject, execute payments and manage project records |
| Auditor | `auditor@demo.civicproof.test` | Read invoices and decisions; officially verify delivery and reconcile chain transactions |

Passwords are shared privately, not committed to Git or bundled into frontend
source. On P2's setup computer they are saved encrypted in the ignored
`.local/demo-credentials.xml`; see [SUPABASE-SETUP.md](SUPABASE-SETUP.md) for retrieval.
Public signup is disabled. These are the four existing seeded Auth accounts.

Sign in using `supabase.auth.signInWithPassword({ email, password })`.
Send the returned session's `access_token` as `Authorization: Bearer ...` on
protected Edge requests. Subscribe to Auth session changes so refreshed tokens
are used. Sign out before changing demo accounts and clear that user's query cache.

## The database structure

IDs are UUIDs. Money fields ending in `_cents` are integer cents: R100 = 10000.
All fourteen public application tables have RLS. The SQL files contain the full
types, constraints and indexes: start with [schema.sql](../supabase/schema.sql),
then apply the files in [migrations](../supabase/migrations/) in timestamp order.
`schema.sql` alone is not the final deployed schema.

The columns below are the main fields used when connecting the UI; timestamps
and constraints are detailed in the SQL.

| Table | Main columns | How it connects |
| --- | --- | --- |
| `users` | `id`, `display_name`, `role` | `id` matches the Supabase Auth user; role is trusted database data |
| `projects` | `id`, `code`, `name`, `description`, `location`, `budget_cents`, `permitted_categories`, `created_by` | Parent of milestones, invoices, wallets, concerns and ledger records |
| `project_wallets` | `project_id`, `mode`, `wallet_address` | One wallet per project per chain; key is `(project_id, mode)` |
| `suppliers` | `id`, `user_id`, `name`, `registration_no`, `registered_on`, `verified`, `contact_name`, `contact_email`, `contact_phone`, `wallet_address` | `user_id` says which logged-in user owns the supplier |
| `milestones` | `id`, `project_id`, `code`, `title`, `description`, `status`, `verified_at` | A delivery target belonging to one project |
| `reference_prices` | `id`, `sku`, `description`, `category`, `unit`, `unit_price_cents`, `source`, `effective_on` | Benchmarks used by invoice analysis |
| `invoices` | `id`, `project_id`, `supplier_id`, `submitted_by`, `milestone_id`, `invoice_number`, `invoice_date`, `total_cents`, `document_path`, `document_sha256`, `status`, `ledger_mode` | Links the project, supplier, PDF and optional delivery requirement |
| `invoice_items` | `id`, `invoice_id`, `line_index`, `description`, `category`, `reference_sku`, `quantity`, `unit_price_cents`, `line_total_cents` | Invoice's individual lines; `reference_sku` links a benchmark |
| `ai_reviews` | `id`, `invoice_id`, `extraction`, `checks`, `flags`, `benchmarks`, `potential_excess_cents`, `recommendation`, `explanation`, `mode` | Analysis results; current mode is deterministic `rules` |
| `approvals` | `id`, `invoice_id`, `actor_id`, `decision`, `reason`, `overrode_ai`, `ai_review_id` | The human decision and the review it considered |
| `transactions` | `id`, `project_id`, `invoice_id`, `milestone_id`, `operation`, `amount_cents`, `mode`, `status`, `tx_hash`, `block_number`, `error_code`, `confirmed_at` | Mode-specific ledger and chain receipts |
| `evidence` | `id`, `milestone_id`, `uploaded_by`, `object_path`, `document_sha256`, `caption`, `duplicate_of` | Photo metadata; file bytes live in private Storage |
| `verifications` | `id`, `milestone_id`, `actor_id`, `kind`, `note` | Community evidence or an official verification; no `answer` column yet |
| `concerns` | `id`, `project_id`, `raised_by`, `message`, `status`, `response`, `responded_by`, `responded_at` | Citizen concerns and municipality responses |

The unexposed `private` schema contains `runtime_config` (active wallet mode),
`chain_dispatch` (sender ownership and recovery), and internal helpers. The UI
does not read or write those directly.

## What the UI should call

Every Edge path below is relative to `VITE_API_URL`.
Responses use `{ "data": ... }`; errors use
`{ "error": { "code": "...", "message": "..." } }`.

| Need | Call | Notes |
| --- | --- | --- |
| Public project cards/details | `GET /projects`, `GET /projects/:id` | Redacted responses; default mode comes from server configuration |
| Project wallet and ledger | `GET /projects/:id/wallet`, `GET /projects/:id/transactions` | Mode is included; do not sum different chains |
| Supplier names | `GET /suppliers` | Public safe fields; invoice list itself has no `supplier_name` |
| Current user and owned suppliers | `GET /me` | Real login required; see response below |
| Review queue / own invoices | `GET /invoices?status=submitted,analysed,on_hold,approved,payment_failed` | Comma-separated support is deployed; add `project_id=UUID` if needed |
| Invoice details | `GET /invoices/:id` | Raw invoice plus `items`, `ai_reviews`, `approvals`, `transactions` arrays |
| Submit invoice | `POST /invoices` | Multipart `file` plus `invoice` JSON string |
| Analyse | `POST /invoices/:id/analyse` | Municipality; rules analyse submitted manual line items |
| Human decision | `POST /invoices/:id/approve`, `/hold`, `/reject` | Municipality; JSON `{reason}`; see rules below |
| Execute payment | `POST /payments/:invoiceId/execute` | Municipality; JSON `{}`; chain confirmation determines success |
| Register milestone | `POST /milestones/:id/register` | Municipality; JSON `{}` |
| Officially verify | `POST /milestones/:id/verify` | Municipality/auditor; JSON `{}` |
| Upload delivery photo | `POST /milestones/:id/evidence` | Citizen/supplier; multipart `file`, optional `caption` |
| Community confirmation | `POST /milestones/:id/confirm` | Citizen; JSON `{note}`; currently returns an array of inserted records, HTTP 201 |
| Raise/respond to concern | `POST /projects/:id/concerns`, `POST /concerns/:id/respond` | Citizen sends `{message}`; municipality sends `{response}` |
| Check pending chain work | `POST /chain/reconcile` | Municipality/auditor; JSON `{}`; checks recorded hashes |

Other municipality routes create projects, suppliers and milestones; see
[BACKEND.md](BACKEND.md). Creating/funding new project wallets on-chain is not yet
wired into the API; the configured chain demo uses CP001.

### Supplier selection: already deployed

`GET /me` returns these fields inside `data`:

```ts
{
  id: string;
  display_name: string;
  role: 'citizen' | 'supplier' | 'municipality' | 'auditor';
  wallet_mode: 'simulated' | 'fuji' | 'bsc';
  supplier_ids: string[];
  suppliers: { id: string; name: string }[];
}
```

The supplier demo user owns three suppliers, so there is no single automatic
`supplier_id`. Show `me.suppliers` in a dropdown and send the selected `id`.
The server checks `suppliers.user_id = authenticated actor`; selecting somebody
else's supplier does not bypass ownership. Users without owned suppliers receive
empty arrays, including staff who can read other suppliers for their work.

### Status lists: already deployed

One status, several comma-separated statuses, or no filter are supported.
Spaces and duplicate values are accepted. Unknown values or empty list entries
return HTTP 400. Supplier/staff RLS still limits which invoices can be returned.

### File payloads

```ts
const form = new FormData();
form.set('file', pdfFile);
form.set('invoice', JSON.stringify({
  project_id: '10000000-0000-4000-8000-000000000001',
  supplier_id: selectedOwnedSupplierId,
  invoice_number: 'BB-001',
  invoice_date: '2026-11-18',
  total_cents: 11840000,
  // milestone_id: optional registered milestone UUID,
  line_items: [{
    description: '10,000 L tank', category: 'water_storage',
    reference_sku: 'TANK-10000L', quantity: 8,
    unit_price_cents: 1480000, line_total_cents: 11840000,
  }],
}));
```

Use `invoice`, not `data`, for the JSON part. Do not manually set multipart
Content-Type. Evidence uses `file` and optional `caption`, not a JSON `data` part.

Storage has two private buckets: `invoices` for PDFs and `evidence` for JPEG,
PNG or WebP. Each file is limited to 10 MiB. Upload through Edge; it checks the
bytes, computes SHA-256 and records metadata. For permitted downloads use
`supabase.storage.from('invoices').createSignedUrl(document_path, 60)`.
Storage RLS checks ownership/staff permissions; public dashboards have no private paths.

## P1's remaining requests: what exists and what is pending

| Request | Current truth | What P1 can use now |
| --- | --- | --- |
| Real login | Four Auth accounts exist; frontend must sign in | Supabase JS login and user token; passwords shared privately |
| Milestones embedded in project response | Not implemented; no GET milestone Edge route yet | Direct Supabase milestone read below, protected by existing public-read policy |
| Supplier IDs | Deployed in `/me` | `supplier_ids` and named `suppliers` array |
| Yes / No / Not sure column | Not implemented; `verifications` currently stores `note` | `{note: '[yes] ...'}`, `[no]` or `[not_sure]` as P1 proposed |
| Approver display names | Not embedded; approvals contain `actor_id` | Show actor ID until the backend adds safe display-name enrichment; other users' profiles are not generally readable |
| Several review statuses | Deployed | Comma-separated `status` parameter |
| Supplier names on invoice list | Not embedded | Look up `supplier_id` using `GET /suppliers` |

The milestone table can already supply the fields P1 requested:

```ts
const { data: milestones, error } = await supabase
  .from('milestones')
  .select('id,project_id,code,title,description,status,verified_at')
  .eq('project_id', projectId)
  .order('code');
```

Milestone `status` is `pending` or `verified`. Registration is a separate ledger
operation, not a third milestone status. Community confirmation never counts as
official verification and never unlocks a payment.

## Payment rules and current chain setup

CP001: `10000000-0000-4000-8000-000000000001`.
M1: `30000000-0000-4000-8000-000000000001`.
Active mode: **Fuji**, chain ID **43113**.
Wallet: `0xAdA383A5DF097C3Ef1F23ee2d4db670A8Ac83D4D`.
Opening funded balance: **200000000 cents (R2,000,000 in DemoZAR test tokens)**.
M1's setup registration receipt is imported; official verification is separate.

Only municipality users decide or execute payments. Self-approval is blocked.
Hold/reject need a reason; approving against analysis flags also needs a reason.
Approvals reserve budget. Delivery-linked payments require official verification.
Hold stays off-chain. The backend prevents duplicate releases.

Chain writes may return HTTP 202 with `chain_status: 'pending'`. Keep the returned
record ID and hash, show pending and the returned explorer link where available.
Use the existing action/reconciliation flow; do not create a new invoice as a retry.
The hash is stored before broadcast. Unknown outcomes stay pending until checked.
Ordinary reads and off-chain hold do not all include `chain_status`.

Display **Avalanche Fuji** for `fuji`, **BNB Chain testnet** for `bsc`, and
**Simulated ledger** for `simulated`. BNB adapter support exists, but its deployment
still needs configuration. Direct dashboard RPC calls must pass the intended
`p_mode`; its SQL default is simulated. Edge project routes resolve the active mode.

Analysis currently uses deterministic rules on manually supplied line items.
PDF extraction and LLM explanations remain P4's integration work.

## Verification and ownership

Edge version 9 includes the supplier fields and status-list fixes. Strict Deno
checking and read-only live checks passed for all four roles. The simulator and
chain scenarios are documented in [SUPABASE-VERIFICATION.md](SUPABASE-VERIFICATION.md).
`scripts/Test-CivicProofFrontendAccess.ps1` reruns the read-only login/ownership/filter
checks while Fuji stays active. `scripts/Test-CivicProofChainReadiness.ps1` checks
signer configuration without sending a payment.

P1 connects the UI on their branch. P2 owns schema, RLS, Storage and Edge changes
on `p2/backend`. P3 owns contracts/deployments and helps integrate the chain adapter.
This document does not mean the pending milestone/answer/name additions are deployed.
