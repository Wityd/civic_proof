# CivicProof backend: Supabase first

Branch: `p2/backend`. No merge into `main` is authorised.
Project: `crshjvjrgnnypxbpjmob` (`CivicProof_Project`).

For the current UI handoff in one document, use [SUPABASE-P2.md](SUPABASE-P2.md).

## Architecture decision

Express is replaced by Supabase Auth, the Data API, RLS policies, Postgres
functions and a deployed Edge Function. There is no separate Express service to
host. This supersedes the original build plan's browser-to-Express-only design.

```text
Browser -> Supabase Auth                   login/session
Browser -> Supabase Data API + RLS         permitted reads and ordinary writes
Browser -> civicproof-api Edge Function    sensitive actions and file validation
Edge Function -> service-only SQL RPC      atomic workflow and financial changes
Edge Function -> P3 chain adapter          Fuji / BNB signing and receipt checks
Edge Function -> P4 adapter                PDF/LLM integration (pending)
```

The browser uses a publishable/anon key and the user's JWT. The service-role key
remains server-side. Every sensitive Edge route verifies the JWT with Supabase
Auth and loads the trusted database role. Editable user metadata grants no role.

## Configured access

Four demo roles remain citizen, supplier, municipality and auditor. Email/password
login is enabled; signup and anonymous login are disabled. All fourteen public
application tables retain RLS. The unexposed `private` schema contains runtime
configuration and narrowly scoped role/redaction helpers.

| Resource | Direct browser access |
| --- | --- |
| Projects, project wallets, milestones, reference prices | Public reads; no direct writes |
| `get_public_dashboard` RPC | Public, mode-filtered financial summary with explicit redaction |
| Users | Own profile read and `display_name` update; no role or identity changes |
| Suppliers | Own/staff reads; supplier updates own contact fields only |
| Invoices, items, AI reviews, approvals | Owning supplier or staff reads; no direct writes |
| Transactions | Staff or authorised supplier reads; no direct writes |
| Concerns | Citizen inserts own concern; own/staff reads; responses through Edge |
| Verifications | Application-user reads; citizen inserts own community confirmation only |
| Evidence | Application-user metadata reads; uploads through Edge |
| Storage | Authorised private downloads/signed URLs; validated uploads through Edge |

No browser may directly set invoice status, AI output, official verification,
wallet addresses, trusted roles or confirmed transaction records. Public dashboard
data omits supplier contacts, user emails, document paths and submitter identities.

## Deployed Edge actions

Base URL: `https://crshjvjrgnnypxbpjmob.supabase.co/functions/v1/civicproof-api`.
Responses use `{data: ...}` or `{error: {code, message}}`.

| Route | Behavior |
| --- | --- |
| `GET /health`, `/projects`, `/projects/:id`, `/projects/:id/wallet`, `/projects/:id/transactions`, `/suppliers`, `/suppliers/:id` | Public health and redacted reads |
| `GET /me`, `/invoices`, `/invoices/:id` | Verified identity, owned suppliers, multi-status filters and RLS-scoped details with approval actor display names |
| `POST /projects`, `/suppliers`, `/projects/:id/milestones` | Municipality creates records; simulated project funding is atomic |
| `POST /invoices` | Supplier PDF + manual JSON, byte validation, SHA-256 and atomic invoice/items/ledger insertion |
| `POST /invoices/extract` | Supplier uploads a PDF (`file`, `project_id`, `supplier_id`); Gemini reads it into a form **draft**: `invoice_number`, `invoice_date`, `line_items` (category only if permitted, else null), `total_cents`, `confidence`, `warnings`. Stores nothing, no chain transaction. 422 `EXTRACTION_FAILED` when it can't be read |
| `POST /invoices/:id/analyse` | Municipality runs the deterministic rules (with catalogue matching); with `AI_MODE=llm`, Gemini also reads the PDF (`DOCUMENT_MISMATCH` against the form) and words the explanation |
| `POST /invoices/:id/approve`, `/hold`, `/reject` | Atomic decisions, reasons, state changes and fund reservations |
| `POST /payments/:invoiceId/execute` | Municipality; idempotent release in the active ledger mode |
| `POST /milestones/:id/register`, `/verify` | Municipality registers; municipality/auditor officially verifies |
| `POST /milestones/:id/evidence`, `/confirm` | Validated image evidence; citizen community confirmation |
| `POST /projects/:id/concerns`, `/concerns/:id/respond` | Citizen raises concern; municipality responds |
| `POST /chain/reconcile` | Municipality/auditor; checks stored hashes against chain receipts and settles confirmed results |
| `GET /chain/status?mode=fuji&project_id=UUID` | Municipality/auditor; read-only signer, roles, gas and wallet readiness |

Project/dashboard responses embed public milestone fields. Community confirmation
accepts `answer: yes | no | not_sure` and optional note; omitted answers remain null.
Approval display names are enriched through a service-only RPC that repeats
invoice access checks; general user-profile RLS is unchanged.

Invoice multipart fields are `file` and `invoice` (JSON). Evidence fields are
`file` and optional `caption`. Requests and files are size-limited; invoice PDFs
and image signatures are checked; actual file bytes are hashed. Failed database
submissions remove the newly uploaded object. Both buckets remain private with
10 MiB file limits. CORS and consistent validation errors are implemented.

## Financial rules

Money is integer cents, limited at HTTP input to safe integers up to
1,000,000,000,000. IDs are UUIDs; duplicate invoices remain storable for detection.
The existing invoice state machine and self-approval protection are retained.
Approvals lock the project and invoice in a consistent order, reserve funds, and
require a reason when overriding flags. Hold/reject require reasons. Payments use
the same locks, return existing releases and require official milestone
verification when linked. Concurrent requests cannot pay twice or over-reserve.

Registration is separate from delivery verification. Community confirmation
never authorises payment. Hold stays off-chain. The one-live-release constraint
is global per invoice across `simulated`, `fuji` and `bsc`.

## Remaining integrations

The deployed mode is **fuji** for CP001. P3's Edge-compatible adapter is integrated;
the three setup receipts were checked against chain 43113 and imported. Signing
secrets are installed in Supabase. Read-only preflight matched CP001, both required
contract roles, gas and the R2,000,000 test-token balance. See [CHAIN-MODE.md](CHAIN-MODE.md).
BNB is supported by the adapter but needs its own wallet and deployment configuration.
A caller-supplied hash or webhook alone cannot change financial state.

P4 can integrate PDF extraction and LLM explanations. Current `mode: rules`
analysis checks the manually submitted line items; it does not claim to extract
PDF text. No external AI keys have been installed. A
destructive demo-reset endpoint is not exposed.

## Files and verification

- `supabase/schema.sql`: fresh fourteen-table baseline; then apply migrations.
- `supabase/migrations/*_supabase_first_backend.sql`: versioned RLS/RPC changes.
- `supabase/functions/civicproof-api/`: deployed router and runtime configuration.
- `supabase/functions/_shared/rules.ts`: deterministic P4 fallback adapter.
- `supabase/tests/integration_test.ts`, `scripts/Test-SupabaseFirst.ps1`: live
  HTTP/RLS/concurrency/golden-path verification in an isolated, cleaned-up project.
- [FRONTEND-CONTRACT.md](FRONTEND-CONTRACT.md): exact UI calls and payloads.
- [P3-INTEGRATION.md](P3-INTEGRATION.md): CP001 and M1 UUIDs and chain handoff.
- [SUPABASE-SETUP.md](SUPABASE-SETUP.md): encrypted demo-login retrieval.

Credentials stay encrypted locally and ignored by Git. CP001 seed data is
preserved during verification. Leaked-password protection requires a paid plan;
no upgrade was performed.
