# Supabase-first verification

Verified 2026-11-20 against `CivicProof_Project`, reference
`crshjvjrgnnypxbpjmob`, on branch `p2/backend`. No merge performed.

| Check | Result |
| --- | --- |
| Edge code | Deno strict type check passed; deployed `civicproof-api` is active |
| Rules adapter | Seven tests passed: fair/overpriced/wrong-purpose, arithmetic, duplicates, budget, supplier age and threshold boundaries |
| Authentication | All four demo roles signed in; missing/forged user tokens rejected |
| Trusted roles | Each user reads own profile only; direct role escalation and service-only RPC calls rejected |
| Browser Data API | Public project reads and redacted dashboard work; own/staff invoice reads follow RLS |
| Ordinary writes | Citizen concern insertion works; actor impersonation and official-verification forgery rejected |
| Trusted fields | Direct invoice status and transaction writes rejected |
| Files | PDF submission hashes actual bytes; authorised supplier/auditor downloads work; citizen invoice download denied |
| Reviews | Fair invoice approves; inflated pipe invoice holds with R136,000 excess; wrong-purpose vehicle rejects |
| Override | Flagged approval without reason rejected; hold/reject require written reasons |
| Payment concurrency | Two simultaneous execute requests return the same confirmed release |
| Budget concurrency | Of two simultaneous approvals exceeding available funds together, one succeeds and the other returns 409 |
| Delivery | Registration required; payment blocked before official verification; community confirmation alone does not unlock payment |
| Duplicate evidence | Repeated image bytes produce `DUPLICATE_EVIDENCE` |
| Golden path | R2,000,000 -> R1,881,600 -> R1,817,600 in the isolated simulated test project |
| Redaction | Public response excludes private paths/hashes, supplier contacts and submitter identity |
| Chain boundary | Staff receive `503 CHAIN_NOT_READY`; unconfigured chain input never updates payment records |
| Original database guards | Rolled-back checks passed for multichain wallets, BSC confirmation, cross-project links, invoice states and duplicate-release prevention |
| Cleanup | Test project, invoices, evidence, ledger records, supplier fixture and files removed; CP001 preserved |
| Final baseline | One real demo project, four trusted users, zero submitted invoices and zero stored files; runtime simulated |

Run `scripts/Test-SupabaseFirst.ps1` in a private PowerShell session. It obtains
local encrypted credentials, passes secrets only through the test process's
environment, and clears those environment values afterward. The test creates an
isolated project, uses real HTTPS endpoints and cleans up in `finally`.

## Security advisors

No ERROR findings. One INFO finding is intentional: `private.runtime_config`
has RLS but no browser policies because only the trusted service role accesses
it. Public application tables now have appropriate RLS policies.

The existing leaked-password protection warning remains: Supabase requires Pro
or above for that feature. No paid upgrade was performed. See
[Supabase password security](https://supabase.com/docs/guides/auth/password-security).
Demo passwords are random; signup remains disabled.

## Limits

This verifies a working simulated backend. Live chain signing/reconciliation
requires P3's adapter and deployment configuration. PDF extraction and LLM
explanations require P4's adapter. Neither integration is represented as complete.
The current code accepts no unauthenticated blockchain webhook or caller-asserted
transaction confirmation. A destructive reset endpoint is not deployed.
