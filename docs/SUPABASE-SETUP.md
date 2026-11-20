# CivicProof Supabase setup

Project: `CivicProof_Project` (`crshjvjrgnnypxbpjmob`). Branch: `mzoo`.

## Applied configuration

- 13 application tables in `public`, with UUID keys, foreign keys, indexes,
  integer-cent money fields and validation constraints.
- RLS enabled on every application table. Browser `anon` and `authenticated`
  roles have no direct table privileges or policies. The backend service role
  performs authorized database operations through the future Express API.
- Four confirmed-email demo Auth users, each linked by UUID to `public.users`.
  Trusted roles live in that table, not editable user metadata.
- Email/password sign-in enabled. Public signup and anonymous sign-in disabled.
  Minimum password length is 12. The four demo passwords are randomly generated.
- Private `invoices` bucket: PDFs only, maximum 10 MiB per file.
- Private `evidence` bucket: JPEG, PNG and WebP only, maximum 10 MiB per file.
- No browser upload/download policies. The backend authorizes access and can
  later issue short-lived signed links as needed.

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
to support the role-switching demo. Wallet addresses are null until P3 supplies
test wallets. There are no invoice rows or pretend file paths in the seed.

Reference SKUs: `TANK-10000L` at R14,500.00, `PIPE-HDPE-250-12` at R5,200.00,
and `INSTALL-TANK` at R7,500.00. Every price source is labelled fictional.
Simulated opening transactions must be filtered by `mode`; they do not represent
Fuji funding. P3 will create and fund the real testnet wallet separately.

## Database guards and remaining API work

The schema enforces valid invoice state changes, a confirmed matching release
before `paid`, same-project milestone links, one live release per invoice,
municipality-only approval actors, no self-approval, and a reason plus recorded
override when approving an AI-flagged invoice. Invoice numbers and document hashes
remain nonunique so the AI rules can flag duplicate submissions.

The API is still to be written. It must verify JWTs, enforce supplier ownership,
authorize all operations, make decisions and invoice updates atomic, lock/reserve
project funds, enforce verified delivery before release, reconcile wallet calls,
and redact public responses. These functions are not supplied by merely creating
the database. P3's wallet service remains responsible for the actual money flow.

## Reproducible setup and verification

- `supabase/schema.sql`: canonical schema applied to the inspected empty database.
  Run once; it intentionally fails rather than replacing existing tables.
- `supabase/seed.sql`: repeatable inserts for the fictional demo baseline.
- `scripts/Initialize-CivicProofSupabase.ps1`: provisions this exact project using
  the saved token. Existing demo accounts are preserved; passwords are not reset.
- `supabase/verify.sql`: transactional database safety checks with rolled-back
  fixtures. It creates no permanent test records.
- `scripts/Test-CivicProofSupabase.ps1`: checks live sign-ins, roles, data access,
  bucket restrictions, temporary backend upload/download and security advisors.
  Temporary uploaded files are removed in a `finally` block.
- `.local/setup-verification.json`: local verification results without credentials.

Setup scripts run from this repo in Windows PowerShell using the same invocation
as the token setup script (`-NoProfile -ExecutionPolicy Bypass -File ...`). Never
print the MCP header helper's output: it contains the bearer token.

Live checks passed; see [SUPABASE-VERIFICATION.md](SUPABASE-VERIFICATION.md).
The only remaining security warning is leaked-password protection, which the
current Supabase plan does not include. No paid upgrade was performed.
