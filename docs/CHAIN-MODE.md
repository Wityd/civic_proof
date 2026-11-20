# Chain mode: real Avalanche (or BNB) payments from the app

**Owner: P3.** With chain mode on, every money action in the app becomes a real transaction on CP001's `ProjectWallet` contract, with a Snowtrace link. Simulated mode keeps working exactly as before, and switching between them is one SQL line.

## What changes when chain mode is on

| App action (route) | On chain | If the rules say no |
| --- | --- | --- |
| Supplier submits invoice (`POST /invoices`) | `submitPaymentRequest`: anchors the PDF's SHA-256 | Invoice is not created |
| Approve / reject (`/invoices/:id/approve`, `/reject`) | `approvePayment` / `rejectPayment` | Refused **before** anything is sent (missing reason, self-approval, budget) |
| Hold (`/invoices/:id/hold`) | **nothing**: hold stays off-chain | n/a |
| Execute payment (`/payments/:id/execute`) | `releasePayment`: dZAR goes to the supplier | `409 MILESTONE_NOT_VERIFIED` and similar; nothing sent |
| Register / verify milestone (`/milestones/:id/register`, `/verify`) | `registerMilestone` / `verifyMilestone` | Refused before sending |
| Public dashboard (`GET /projects`) | Shows the **active** mode's ledger by default | n/a |

Every response in chain mode adds `chain_status` (`confirmed` or `pending`) and `explorer_url` (the Snowtrace or BscScan link). The frontend can show that link right away.

**How it stays consistent:** each action is *prepare* (database: the same rule checks as simulated mode, plus a `pending` row) → *chain* (dry run first, so a rule violation costs no gas, then send and confirm) → *settle* (database: record the real hash and block, or roll back).

- If the network is down before sending: `502 CHAIN_UNAVAILABLE`, nothing is changed, and you can simply retry.
- If confirmation is slow: `202` with `chain_status: "pending"` and the hash. Retrying **never sends twice**. `POST /chain/reconcile` (municipality or auditor) settles every pending transaction once it's mined.

## Turning it on (one-time, about 5 minutes)

1. **Apply the migrations**, after the baseline backend migrations:
   - `supabase/migrations/20261120181321_p3_chain_mode.sql`
   - `supabase/migrations/20261120181352_chain_recovery_guards.sql`
   These names match the hosted migration history. Both are already applied to CivicProof_Project.
2. **Apply the deployment data** in the SQL editor:
   - `supabase/deployments/cp001_fuji_wallet.sql` (already applied by P2)
   - `supabase/deployments/demo_supplier_wallets.sql`
   - `supabase/deployments/cp001_fuji_ledger.sql`: generate it first, from `contracts/`:
     ```bash
     npm run export-ledger:fuji
     ```
     This reads CP001's real setup transactions (created, funded R2,000,000.00, M1 registered) from Fuji.
3. **Set the Edge Function secrets** (never in the frontend):
   ```bash
   powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/Set-CivicProofChainSecrets.ps1
   ```
   Enter the key privately at the hidden prompt. It must match the deployer
   `0xC3D73FAf9aa330D3448bEEF134Cff4560C75f753`. The script validates that public
   address and installs the key, Fuji RPC and two-confirmation setting as Edge secrets.
4. **Deploy the function:** `supabase functions deploy civicproof-api`
5. **Check readiness** with `scripts/Test-CivicProofChainReadiness.ps1`. It calls
   the staff-only `GET /chain/status?mode=fuji&project_id=UUID` without signing or
   broadcasting. Confirm project match, both roles, gas and wallet balance.
6. **Switch the mode** (SQL editor):
   ```sql
   update private.runtime_config set wallet_mode = 'fuji' where singleton;
   ```

**Back to simulated** at any time (for example if Fuji misbehaves during the demo):

```sql
update private.runtime_config set wallet_mode = 'simulated' where singleton;
```

The two ledgers are kept separate. Invoices created in one mode stay in that mode.

## Gas

Measured: one full CP001 demo run (4 submits, 2 approvals, 1 rejection, 1 verification, 2 payments) uses about 0.85 M gas, roughly 0.002–0.02 test AVAX depending on the Fuji gas price. Rehearse in simulated mode and save the AVAX for the real run.

## Testing

```bash
cd contracts && npx hardhat compile          # once, for the artifacts
deno test -A supabase/tests/chain_mode_test.ts
```

This runs P2's real schema and migrations (in-memory Postgres) against the real contracts (local Hardhat node). It covers the full CP001 golden path ending at R1,817,600.00 on chain and on the dashboard, refusals before sending, rollback when the chain refuses, network-down retry, and the timeout → pending → reconcile path.

## Limits (MVP)

- **Creating new projects** in chain mode isn't wired into the API yet: use `contracts` → `npm run setup:demo:fuji`, then `export-ledger:fuji`. CP001 is already live.
- **One server key** signs every transaction. The on-chain roles prove the rules were followed, not which person clicked. In production each approver would sign with their own key or a multisig.
- **One sender per chain** is enforced by a private database claim. Other actions
  stay pending until retried after that sender finishes. Pending approvals reserve
  budget. Only the service role can claim or settle; browser roles cannot call these RPCs.
- **Uncertain broadcasts stay pending.** The signed hash is stored before broadcast
  and cannot be replaced. Missing receipts do not prove failure. Staff reconciliation
  checks recorded hashes; it never blindly resends. A crash between persistence and
  broadcast, or a permanently dropped transaction, needs operator investigation.
  Claims without any recorded hash can be retried after ten minutes. Retained files
  with an uncertain commit outcome may need later orphan cleanup.

## Deployment verified by P2 — 2026-11-20

Database migrations, supplier wallets and three verified setup receipts are applied.
The updated `civicproof-api` is deployed and runtime mode is Fuji. Read-only signer
preflight passed for CP001, both contract roles and gas. The wallet holds
200000000 cents in DemoZAR test tokens; M1 is registered, not officially verified.
No testnet payment was sent during deployment verification.

Local tests passed all 14 chain scenarios, including the golden path, timeout
reconciliation, service-role rollback, sender claims, pending budget reservations
and persistence-failure handling. The deployed simulated HTTP/RLS/storage suite
also passed before activation and removed its isolated fixtures.
