# P2/P3 integration contract

P3's four shared-contract changes are accepted: one ProjectWallet per project per
chain, Fuji and BNB testnet modes, on-chain milestone registration before linking
an invoice, and off-chain hold. P3's contract PR #2 was already merged into main
when this update was prepared; P2 did not merge it again.

## Live database

`public.project_wallets` stores `(project_id, mode, wallet_address)` plus timestamps.
The primary key `(project_id, mode)` permits one wallet per chain per project.
Wallet addresses must be valid nonzero EVM addresses. The same address cannot be
assigned to two projects on the same chain, including with different letter case.
RLS is enabled; wallet mappings are publicly readable and writable only by the backend.

Wallet-row modes are `fuji` and `bsc`. The simulated ledger has no invented chain
address. `transactions.mode` supports `simulated | fuji | bsc`, and operations
include `register_milestone`. Both registration and verification records require
a same-project milestone. A confirmed Fuji or BSC transaction needs a hash,
confirmation timestamp and block number.

The one-live-release index remains unique by invoice across every mode. Switching
networks must never allow a second payment of the same invoice. Wallet balances
and ledger reads must always filter by the active mode; never sum both chains.

CP001's supplied Fuji wallet address has now been verified and recorded:
`0xAdA383A5DF097C3Ef1F23ee2d4db670A8Ac83D4D`. Read-only Fuji RPC calls on chain
43113 matched CP001's project hash and allocation; funded and balance values were
both 200000000 cents. Its token getter returned
`0x1be50e878326F3DDb90B03a817B0F266B23a58E1`, and M1 status was Registered (1),
not officially Verified (2). The repeatable mapping SQL is
`supabase/deployments/cp001_fuji_wallet.sql`.

The three Fuji setup receipts were verified and imported from
`supabase/deployments/cp001_fuji_ledger.sql`. P3's adapter is integrated and the
runtime is now Fuji. The factory is `0x6E243F5e663DB56f8d4e5e3B32E24BAf3779c791`.
See [CHAIN-MODE.md](CHAIN-MODE.md) for deployment and recovery details.

## Demo IDs for P3

These values were read back from the live Supabase records and match `seed.sql`:

```dotenv
PROJECT_UUID=10000000-0000-4000-8000-000000000001
MILESTONE_M1_UUID=30000000-0000-4000-8000-000000000001
PROJECT_ALLOCATION_CENTS=200000000
```

M1 belongs to CP001. Use these same UUID strings on both chains. P3's `idOf`
helper hashes the UTF-8 UUID string with keccak256.

## Configuration and adapter calls

- `private.runtime_config.wallet_mode`: `simulated|fuji|bsc`, one active mode.
  The deployed Edge Function reads this database value; no WALLET_MODE secret is needed.
- `FACTORY_ADDRESS` replaces `WALLET_CONTRACT_ADDRESS`. It is the factory for the
  selected chain, separate from each project's wallet address.
- `DEMOZAR_ADDRESS` must also belong to the selected chain.
- `FUJI_RPC_URL` and `BSC_TESTNET_RPC_URL` match P3's contract configuration.
- Fuji chain ID is `43113`; BNB testnet chain ID is `97`.
- Use Snowtrace links for Fuji, BscScan testnet links for BSC, and no explorer
  links for simulated hashes. Return the active mode in API responses.

`packages/shared/types.ts` exports `LedgerMode`, `TxResult`,
`ProjectWalletRecord` and the updated `WalletService` interface, including
`registerMilestone(milestoneId)`. The API now runs in Supabase Edge Functions;
both simulated and live chain flows are implemented in Edge/Deno. Express is no
longer part of the architecture.

The adapter resolves the project from the invoice or milestone record and looks
up the wallet by `(project_id, active mode)`. Create through the factory, resolve
`factory.walletOf(projectId)`, and persist the deployed address. Do not add a
single ambiguous `projects.wallet` field.

Register M1 on that project's wallet before submitting an invoice linked to M1.
Store the `register_milestone` operation and confirmed receipt. Registration and
verification are different operations: registration alone never permits release.
An off-chain `on_hold` invoice remains Pending on chain.

Please return the factory, DemoZAR and CP001 wallet addresses for each deployed
chain, plus the M1 registration hash and block number. The backend will record
those verified results; it will not fabricate them.

## Deployment and verification artifacts

- `supabase/schema.sql`: canonical schema for a fresh database.
- `supabase/upgrades/project_wallets_multichain.sql`: one-time upgrade of the
  inspected original 13-table database; do not rerun after it has been applied.
- `supabase/verify.sql`: rolled-back tests for dual-chain wallets, per-chain wallet
  uniqueness, BSC registration/confirmation, cross-project links and cross-mode
  duplicate-payment protection.
