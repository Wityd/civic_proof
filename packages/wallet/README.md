# @civicproof/wallet (P3)

The wallet behind every CivicProof payment. One interface, three modes:

| `WALLET_MODE` | Implementation | Where the money lives |
| --- | --- | --- |
| `simulated` (default) | `SimulatedWalletService` | Supabase tables, same rules as the contracts, `sim_<uuid>` hashes |
| `fuji` | `ChainWalletService` | Avalanche Fuji: one `ProjectWallet` contract per project |
| `bsc` | `ChainWalletService` | BNB Smart Chain testnet: the same contracts |

Both implementations pass the **same test suite** (`test/conformance.ts`): the five safety checks and the CP001 golden path ending at R1,817,600.00. Switching mode can't change how the demo behaves.

## For P2: using it in the API

```ts
import { createClient } from "@supabase/supabase-js";
import { createWalletService } from "../../packages/wallet/src";

const supabase = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);

export const wallet = createWalletService(process.env, {
  supabase, // simulated mode
  resolveProjectId: async (kind, id) => {
    // chain modes: which project does this invoice / milestone belong to?
    const table = kind === "invoice" ? "invoices" : "milestones";
    const { data, error } = await supabase.from(table).select("project_id").eq("id", id).single();
    if (error) throw error;
    return data.project_id;
  },
});
```

| API step | Wallet call |
| --- | --- |
| `POST /projects` | `createProject(projectId, budgetCents)`, then `fundProject(projectId, budgetCents)` |
| Milestone created | `registerMilestone(milestoneId, projectId)`: **must happen before** an invoice links to it |
| `POST /invoices` | `submitPaymentRequest(invoiceId, projectId, supplier.wallet_address, totalCents, documentSha256, milestoneId)` |
| `POST /invoices/:id/approve` | `approvePayment(invoiceId)` |
| `POST /invoices/:id/hold` | **nothing**: hold is API-only |
| `POST /invoices/:id/reject` | `rejectPayment(invoiceId)` |
| `POST /milestones/:id/verify` | `verifyMilestone(milestoneId)` |
| `POST /payments/:invoiceId/execute` | `releasePayment(invoiceId)` |
| `GET /projects/:id/wallet` | `getBalance(projectId)` → `{ balanceCents, availableCents }` |

**Every mutation returns a `TxResult`** and never throws for a rule violation:

- `confirmed`: done. Store `txHash` and `blockNumber` in `transactions`.
- `failed` + `error` (e.g. `MILESTONE_NOT_VERIFIED`, `INVALID_STATUS`, `INSUFFICIENT_AVAILABLE`): nothing changed. Return a 409.
- `pending`: sent but not confirmed in time. Store the hash, keep the invoice `payment_pending`, and reconcile later with `getTxStatus(txHash)`. **Never treat it as failed.**

It **throws** `WalletError` only when something is misconfigured or unreachable (bad env, database down). Treat that like `pending`: the outcome is unknown.

All ids are Supabase UUIDs and all money is `bigint` cents.

## Setup

**Simulated mode:** apply `sql/simulated_wallet.sql` once in the Supabase SQL editor (safe to re-run). Only the service-role key can call it. For `demo:reset`, call `wallet.reset()` (simulated only).

**Chain modes:** set `WALLET_MODE`, `DEPLOYER_PRIVATE_KEY`, and optionally `FUJI_RPC_URL` / `BSC_TESTNET_RPC_URL`. Contract addresses come from `packages/shared/abi/addresses.json`, written by `contracts/` `npm run export-abi` after deploying. `FACTORY_ADDRESS` / `DEMOZAR_ADDRESS` override them for the selected chain.

## Tests

```bash
npm install
npm test            # both suites (chain suite needs contracts compiled: npm test in contracts/ first)
npm run test:simulated
```
