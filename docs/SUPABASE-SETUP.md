# CivicProof Supabase setup

Project: `CivicProof_Project` (`crshjvjrgnnypxbpjmob`). Branch: `p2/backend`.

## Applied configuration

P3's wallet update is applied: see [P3-INTEGRATION.md](P3-INTEGRATION.md).
`project_wallets` stores one real wallet per project per chain. Transaction modes
include `bsc`; operations include `register_milestone`. The table is currently
populated for CP001 on Fuji with P3's verified wallet address. See
[P3-INTEGRATION.md](P3-INTEGRATION.md) for the read-only chain checks. Runtime mode
is now Fuji; chain migrations, signing secrets and the Edge adapter are deployed.

- 14 application tables in `public`, with UUID keys, foreign keys, indexes,
  integer-cent money fields and validation constraints.
- RLS enabled on every application table. Browser roles have narrowly scoped
  reads and ordinary writes. Trusted actions use Edge Functions and atomic SQL
  RPCs; Express is replaced. See [BACKEND.md](BACKEND.md) for the permission matrix.
- Four confirmed-email demo Auth users, each linked by UUID to `public.users`.
  Trusted roles live in that table, not editable user metadata.
- Email/password sign-in enabled. Public signup and anonymous sign-in disabled.
  Minimum password length is 12. The four demo passwords are randomly generated.
- Private `invoices` bucket: PDFs only, maximum 10 MiB per file.
- Private `evidence` bucket: JPEG, PNG and WebP only, maximum 10 MiB per file.
- Authenticated Storage reads/signed URLs are allowed by ownership and role.
  File uploads use the Edge Function for byte validation and hashing.

## Demo accounts

| Role | Email |
| --- | --- |
| Citizen | `citizen@demo.civicproof.test` |
| Supplier | `supplier@demo.civicproof.test` |
| Municipality | `municipality@demo.civicproof.test` |
| Auditor | `auditor@demo.civicproof.test` |

Random passwords are saved **only on the setup computer**, encrypted for its
Windows user in `.local/demo-credentials.xml`. This path is ignored by Git.
The addresses are fictional demo identifiers; no emails are sent.

To view one login privately in your own PowerShell terminal, from the repo root:

```powershell
$accounts = Import-Clixml .\.local\demo-credentials.xml
$login = $accounts | Where-Object Role -eq 'municipality'
$login.Login.UserName
$login.Login.GetNetworkCredential().Password
```

Replace `municipality` with `citizen`, `supplier` or `auditor` to view another.
Do not paste this output into chat, logs, Git, or a public screenshot. Teammates
need the relevant demo login through your private team channel; the encrypted
file itself cannot be decrypted on their computers.

## Demo seed

CP001, Kgotso Valley Water Access, starts with a R2,000,000.00 budget and a labelled
simulated opening ledger. Its permitted categories are `water_storage`, `pipes`
and `installation`. M1 is "8 tanks installed at 4 village sites" and is unverified.

Three fictional suppliers and three fictional benchmark prices are seeded:

| Supplier | Registered | Verified |
| --- | --- | --- |
| Blue Basin Tanks (Pty) Ltd | 2015-01-15 | Yes |
| Pipeworks Direct CC | 2026-10-28 | No |
| Summit Motors (Pty) Ltd | 2016-03-01 | Yes |

The exact Blue Basin and Summit dates are setup defaults for fictional demo data;
P5 can revise them. All three suppliers are assigned to the supplier demo user
to support the role-switching demo. P3's receive-only test wallet addresses are
applied from `supabase/deployments/demo_supplier_wallets.sql`. There are no invoice
rows or pretend file paths in the seed.

Reference SKUs: `TANK-10000L` at R14,500.00, `PIPE-HDPE-250-12` at R5,200.00,
and `INSTALL-TANK` at R7,500.00. Every price source is labelled fictional.
Simulated opening transactions must be filtered by `mode`; they do not represent
Fuji funding. The separately verified Fuji setup ledger is applied from
`supabase/deployments/cp001_fuji_ledger.sql`.

## Database guards and Edge Functions

The schema enforces valid invoice state changes, a confirmed matching release
before `paid`, same-project milestone links, one live release per invoice,
municipality-only approval actors, no self-approval, and a reason plus recorded
override when approving an AI-flagged invoice. Invoice numbers and document hashes
remain nonunique so the AI rules can flag duplicate submissions.

The Edge API is deployed and the simulated end-to-end flow is verified: JWT
verification, role/ownership checks, file submission, deterministic analysis,
atomic decisions and fund reservations, idempotent payment, delivery gates and
public redaction. P3's live signing/receipt adapter is deployed and Fuji readiness
passed. P4's PDF/LLM extraction remains integration work. See [CHAIN-MODE.md](CHAIN-MODE.md).

## Reproducible setup and verification

- `supabase/schema.sql`: canonical schema applied to the inspected empty database.
  Run once; it intentionally fails rather than replacing existing tables.
- `supabase/seed.sql`: repeatable inserts for the fictional demo baseline.
- `supabase/migrations/*_supabase_first_backend.sql`: RLS/RPC changes applied
  after the baseline. Do not rerun on an already migrated database.
- `scripts/Initialize-CivicProofSupabase.ps1`: provisions this exact project using
  the saved token. Existing demo accounts are preserved; passwords are not reset.
- `supabase/verify.sql`: transactional database safety checks with rolled-back
  fixtures. It creates no permanent test records.
- `scripts/Test-SupabaseFirst.ps1`: verifies real HTTP, RLS, financial concurrency
  and the simulated golden path. Run only while runtime mode is simulated; it does
  not switch the live mode. Test-project files and rows are cleaned up.
  `Test-CivicProofSupabase.ps1` forwards to this current test entrypoint.
- `.local/setup-verification.json`: local verification results without credentials.

Setup scripts run from this repo in Windows PowerShell using the same invocation
as the token setup script (`-NoProfile -ExecutionPolicy Bypass -File ...`). Never
print the MCP header helper's output: it contains the bearer token.

Live checks passed; see [SUPABASE-VERIFICATION.md](SUPABASE-VERIFICATION.md).
The only remaining security warning is leaked-password protection, which the
current Supabase plan does not include. No paid upgrade was performed.
