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
| Chain boundary | Staff reconciliation is implemented; browser service-only RPCs remain denied; unauthenticated chain updates are not accepted |
| Original database guards | Rolled-back checks passed for multichain wallets, BSC confirmation, cross-project links, invoice states and duplicate-release prevention |
| Cleanup | Test project, invoices, evidence, ledger records, supplier fixture and files removed; CP001 preserved |
| Final baseline | One demo project, four trusted users, zero submitted invoices and zero stored files; runtime Fuji with three verified setup transactions |
| Chain adapter | 14 local Hardhat/PGlite scenarios passed, including golden path, pending recovery, service-role rollback, claims and persistence failure |
| Fuji readiness | Deployed signer matches expected address, both contract roles, CP001 hash and gas; balance and available both 200000000 test-token cents |
| Edge deployment | Version 8 active; strict Deno check passed; signing secrets remain server-side |

Run `scripts/Test-SupabaseFirst.ps1` in a private PowerShell session. It obtains
local encrypted credentials, passes secrets only through the test process's
environment, and clears those environment values afterward. The test creates an
isolated project, uses real HTTPS endpoints and cleans up in `finally`. The script
refuses to run unless the active mode is simulated; use
`scripts/Test-CivicProofChainReadiness.ps1` for read-only checks while Fuji is active.

## Security advisors

No ERROR findings. Two INFO findings are intentional: `private.runtime_config`
and `private.chain_dispatch` have RLS but no browser policies because only the
trusted service role accesses them. See the
[RLS advisor explanation](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy).
Public application tables have appropriate RLS policies.

The existing leaked-password protection warning remains: Supabase requires Pro
or above for that feature. No paid upgrade was performed. See
[Supabase password security](https://supabase.com/docs/guides/auth/password-security).
Demo passwords are random; signup remains disabled.

## Limits

The simulated deployed flow and local real-contract flow were tested. Fuji was
enabled after read-only production preflight; no live testnet payments were made
as part of deployment verification. PDF extraction and LLM explanations still
require P4's adapter. BNB needs its own deployment configuration before activation.
The current code accepts no unauthenticated blockchain webhook or caller-asserted
transaction confirmation. A destructive reset endpoint is not deployed.
