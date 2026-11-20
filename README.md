# Practical Readiness Passport

The Grade 12 Physical Sciences practical on a learner's phone, with a signed record,
so funders release money only when practicals are verifiably done.

BACISS 2026 hackathon project. **Read [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)
before building any part**: it fixes the attestation format every piece depends on.

## Layout

```
contracts/      Solidity: AttestationRegistry, FundingPool, MockZAR (Hardhat)
api/app/        Python API (FastAPI): enrolment, sync, marking, signatures, relayer
api/prp_sim/    Python: momentum simulation + marking (AUTHORITATIVE copy)
packages/sim/   TypeScript mirror of the simulation, for the phone
spec/           Cross-language test cases (generated from Python)
docs/           Architecture and interface contract
apps/           learner (PWA), dashboard  [in progress]
```

## Simulation (momentum practical)

Each learner gets their own trolley masses, brick mass, card length, spring
strength and timing noise, derived from a seed only the server can issue.
The phone and the server run the same maths; the shared test cases in
`spec/momentum-vectors.json` prove they agree to the last digit.

```bash
cd api && pip install -r requirements-dev.txt && python -m pytest -q   # 35 tests (sim + API)
cd packages/sim && pnpm test                                            # 20 tests
```

If you change `api/prp_sim/momentum.py`, regenerate the cases with
`python -m prp_sim.vectors` (from `api/`) and make the TS copy match.

## API (Python)

```bash
cd api
python -m venv .venv && source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements-dev.txt
cp .env.example .env    # fill in; see comments in the file
uvicorn app.server:app --reload
```

Open http://localhost:8000/docs for every endpoint.

**Rehearse the whole funder flow** (enrol, practical, review, two signatures,
on-chain attest, tranche, sample pass, holdback) against a running API:

```bash
python scripts/demo_flow.py --api http://localhost:8000 --keys ../contracts/deployments/fuji.local.json --pin 2026
```

**Run everything locally with no testnet** (three terminals):

```bash
cd contracts && npx hardhat node
```

```bash
cd contracts && npx hardhat run scripts/deploy.ts --network localhost
```

```bash
cd api && CHAIN_NETWORK=localhost RELAYER_PRIVATE_KEY=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80 uvicorn app.server:app
```

(That key is Hardhat's public test account #0. It is not a secret and is
local-only.)

### Deploy the API on Northflank

- Service from this repo. Dockerfile `api/Dockerfile`, **build context: repo root**.
- Add a Postgres add-on and set `DATABASE_URL` to its connection string.
- Secrets: `SEED_SECRET`, `LEARNER_REF_SECRET`, `RELAYER_PRIVATE_KEY`, `STAFF_PIN`,
  plus `CHAIN_NETWORK=fuji`.
- `contracts/deployments/fuji.json` must be committed before you build.

## Contracts

```bash
pnpm install
cd contracts
npx hardhat test          # 20 tests
```

### Deploy to Avalanche Fuji

1. Get test AVAX for a fresh wallet from the Avalanche Fuji faucet.
2. `cp .env.example .env` and set `DEPLOYER_PRIVATE_KEY` (a testnet-only key).
3. Run:

```bash
pnpm deploy:fuji
```

4. This writes `deployments/fuji.json` (public addresses, commit it) and
   `deployments/fuji.local.json` (demo teacher and moderator keys, **never commit**,
   already gitignored).

The same contracts also deploy to BNB Chain testnet with `--network bscTestnet`.
