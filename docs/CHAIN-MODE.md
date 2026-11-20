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

## Turning it on (one-time, about 10 minutes)

> ⚠️ **Order matters: database first, then the function, then the switch.** The updated `civicproof-api` calls a database function created by the migration. If the function is deployed first, the public dashboard (`GET /projects`) fails until the migration is applied.

| Step | Who | Where |
| --- | --- | --- |
| 1–2 | P2 | Supabase **SQL Editor** |
| 3 | **P3 only**: the key never leaves P3 | Supabase dashboard → **Edge Functions → Secrets** |
| 4–6 | P2 | Terminal, then SQL Editor |

1. **Apply the migration** in the **SQL Editor**: open `supabase/migrations/20261120200000_p3_chain_mode.sql`, paste all of it, then Run. It's safe to run once.
   > Don't use `supabase db push` here: the earlier migrations were applied by hand, so `db push` may try to run them again.
2. **Apply the deployment data** in the SQL Editor, in this order:
   1. `supabase/deployments/cp001_fuji_wallet.sql` (already applied by P2; safe to re-run)
   2. `supabase/deployments/demo_supplier_wallets.sql`
   3. `supabase/deployments/cp001_fuji_ledger.sql` (CP001's real setup transactions on Fuji: created, funded R2,000,000.00, M1 registered)

   **Check** (expect `4 | 3 | 3 | simulated`):
   ```sql
   select (select count(*) from pg_proc where proname like 'cp_chain%') as chain_functions,
          (select count(*) from public.suppliers where wallet_address is not null) as supplier_wallets,
          (select count(*) from public.transactions where mode = 'fuji') as fuji_ledger_rows,
          (select wallet_mode from private.runtime_config) as mode;
   ```
3. **Add the Edge Function secrets** (P3): dashboard → **Edge Functions → Secrets** → add:
   - `DEPLOYER_PRIVATE_KEY`: the key that deployed the contracts (it holds the contract roles). Type it straight into the dashboard; never paste it into chat, git or a terminal command.
   - `FUJI_RPC_URL`: `https://api.avax-test.network/ext/bc/C/rpc`
4. **Deploy the function** from the repo root:
   ```bash
   npx supabase functions deploy civicproof-api --project-ref crshjvjrgnnypxbpjmob
   ```
   If it asks for Docker, add `--use-api`.
5. **Check it's alive:** `https://crshjvjrgnnypxbpjmob.supabase.co/functions/v1/civicproof-api/health` should return `"status":"ok"`, and `…/civicproof-api/projects` should still list CP001.
6. **Flip the switch** (SQL Editor):
   ```sql
   update private.runtime_config set wallet_mode = 'fuji';
   ```
   **First real test:** submit, analyse, approve and execute invoice #1 (8 × R14,800.00) in the app. CP001's wallet on Snowtrace should drop to **R1,881,600.00**: https://testnet.snowtrace.io/address/0xAdA383A5DF097C3Ef1F23ee2d4db670A8Ac83D4D

To regenerate the ledger file (only needed for a new deployment), run this from `contracts/` with the funding transaction hash that `setup:demo` printed:

```bash
NEAR_TX=<fundProject tx hash> npm run export-ledger:fuji
```

**Back to simulated** at any time (for example if Fuji misbehaves during the demo):

```sql
update private.runtime_config set wallet_mode = 'simulated';
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
- **Concurrent payments** from many users at once could collide on the signer's nonce. That's fine for a demo; in production, use a queue or one signer per worker.
