# Supabase verification results

Verified on 2026-11-20 against `CivicProof_Project`, reference
`crshjvjrgnnypxbpjmob`, using the saved local token without displaying it.

| Check | Result |
| --- | --- |
| Application schema | 13 tables; RLS enabled on every table |
| Trusted roles | Four `public.users` rows linked to four confirmed Auth users |
| Password login | Successful sign-in for citizen, supplier, municipality and auditor; verification sessions signed out |
| Auth settings | Email/password enabled; public signup and anonymous sign-in disabled; minimum password length 12 |
| Anonymous access | Direct reads denied for all 13 application tables |
| Signed-in access | Each of the four roles denied direct reads on all 13 tables and direct Storage upload |
| Backend access | Service-role REST reads work |
| Buckets | `invoices` and `evidence` private; 10 MiB file limit; PDF-only invoices and JPEG/PNG/WebP evidence |
| File operations | Backend upload and private download succeeded in both buckets; anonymous private/public reads denied |
| MIME enforcement | Disallowed text uploads rejected in both buckets |
| Test cleanup | Temporary Storage objects deleted; final object count zero |
| Duplicate submissions | Duplicate supplier invoice number and SHA-256 accepted for later rules-based flagging |
| Payment idempotency constraint | Second pending release for the same invoice rejected; retry record allowed after failure |
| Invoice states | Invalid transition and `paid` without confirmed matching release rejected |
| Reviews | Flagged approval requires a reason and records override; self-approval rejected |
| Project isolation | An invoice cannot link to a milestone from another project |
| Seed | CP001, three suppliers, three prices, one unverified milestone, zero invoices |
| Opening ledger | R2,000,000.00, explicitly `simulated`; no Fuji transaction claimed |

Database test fixtures were rolled back. Passwords are encrypted locally in
`.local/demo-credentials.xml`, excluded from Git. Neither passwords nor API keys
are included in this report.

## Security advisor disposition

- No ERROR findings remain.
- Two warnings about browser execution of the pre-existing privileged
  `public.rls_auto_enable()` helper were fixed by revoking execution from
  `PUBLIC`, `anon` and `authenticated`. The helper and its automatic RLS behavior
  remain in place for the owning database role.
- Thirteen `rls_enabled_no_policy` INFO findings are expected: this project uses
  backend-only application data access by design.
- One warning remains: leaked-password protection is unavailable on this
  project's current plan. An enable request returned `entitlement_required`;
  Supabase requires Pro or above. No plan upgrade was performed. Demo passwords
  were generated randomly and public signup is disabled.

## Verification boundary

These checks verify the Supabase foundation. They do not claim that Express
routes, fund reservation under concurrent API requests, chain reconciliation,
P3's wallet, P4's analysis, public redaction or the frontend are implemented.
Those integrations follow after this setup.
