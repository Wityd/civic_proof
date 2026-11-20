// P3: on-chain adapter for civicproof-api (Avalanche Fuji / BNB testnet).
//
// Every call is: dry run (staticCall) → send → wait for confirmation.
//  - A rule violation is caught in the dry run: nothing is sent and no gas is spent.
//  - `onSent(hash)` persists the signed transaction's hash BEFORE broadcasting;
//    a crash or timeout can then be reconciled without sending twice.
//  - A timeout is reported as 'pending' (never 'failed'): the transaction may still land.
import { Contract, FetchRequest, JsonRpcProvider, Wallet, ZeroHash, keccak256, toUtf8Bytes } from 'npm:ethers@6.17.0';
import { PROJECT_WALLET_ABI } from './project_wallet_abi.ts';

export type ChainMode = 'fuji' | 'bsc';
export type ChainStatus = 'confirmed' | 'pending' | 'failed';
export interface ChainResult {
  status: ChainStatus;
  txHash?: string;
  blockNumber?: number;
  /** Solidity custom error as UPPER_SNAKE (e.g. MILESTONE_NOT_VERIFIED), or CHAIN_ERROR. */
  error?: string;
  detail?: string;
}

export const CHAINS: Record<ChainMode, { chainId: number; label: string; explorer: string; rpcEnv: string; defaultRpc: string }> = {
  fuji: { chainId: 43113, label: 'Avalanche Fuji', explorer: 'https://testnet.snowtrace.io', rpcEnv: 'FUJI_RPC_URL', defaultRpc: 'https://api.avax-test.network/ext/bc/C/rpc' },
  bsc: { chainId: 97, label: 'BNB Smart Chain testnet', explorer: 'https://testnet.bscscan.com', rpcEnv: 'BSC_TESTNET_RPC_URL', defaultRpc: 'https://data-seed-prebsc-1-s1.bnbchain.org:8545' },
};

/** On-chain ids: keccak256(utf8(uuid)), the same as contracts/scripts and packages/wallet. */
export const chainKey = (uuid: string) => keccak256(toUtf8Bytes(uuid.toLowerCase()));

/** MilestoneNotVerified → MILESTONE_NOT_VERIFIED */
export const errorCode = (name: string) =>
  name.startsWith('AccessControl') ? 'CHAIN_UNAUTHORIZED' : name.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toUpperCase();

export interface ChainAdapterOptions {
  mode: ChainMode;
  rpcUrl: string;
  privateKey: string;
  /** Blocks to wait for. Default 1 (Fuji/BNB finalise in seconds). */
  confirmations?: number;
  /** After this the result is 'pending'. Default 45 s, inside the Edge Function time limit. */
  timeoutMs?: number;
  /** Override for local tests (Hardhat = 31337). */
  chainId?: number;
}

export class ChainAdapter {
  readonly mode: ChainMode;
  private readonly provider: JsonRpcProvider;
  private readonly signer: Wallet;
  private readonly confirmations: number;
  private readonly timeoutMs: number;
  private readonly expectedChainId: number;
  private ready?: Promise<void>;

  constructor(o: ChainAdapterOptions) {
    if (!CHAINS[o.mode]) throw new Error(`Unknown chain mode ${o.mode}`);
    if (!/^0x[0-9a-fA-F]{64}$/.test(o.privateKey)) throw new Error('DEPLOYER_PRIVATE_KEY is missing or not 0x + 64 hex characters');
    this.mode = o.mode;
    this.confirmations = o.confirmations ?? 1;
    this.timeoutMs = o.timeoutMs ?? 45_000;
    this.expectedChainId = o.chainId ?? CHAINS[o.mode].chainId;
    // Fail fast inside the Edge Function's time limit: a fixed network (no endless
    // auto-detection when the RPC is down) and a 20 s timeout per RPC request.
    const request = new FetchRequest(o.rpcUrl);
    request.timeout = 20_000;
    // cacheTimeout -1: never reuse a cached nonce/receipt (ethers caches identical calls for 250 ms).
    this.provider = new JsonRpcProvider(request, this.expectedChainId, { staticNetwork: true, cacheTimeout: -1 });
    this.signer = new Wallet(o.privateKey, this.provider);
  }

  /** From Edge Function secrets: DEPLOYER_PRIVATE_KEY, FUJI_RPC_URL / BSC_TESTNET_RPC_URL. */
  static fromEnv(mode: ChainMode, env: { get(key: string): string | undefined } = Deno.env): ChainAdapter {
    const c = CHAINS[mode];
    return new ChainAdapter({
      mode,
      rpcUrl: env.get(c.rpcEnv) || c.defaultRpc,
      privateKey: env.get('DEPLOYER_PRIVATE_KEY') || '',
      confirmations: Number(env.get('WALLET_CONFIRMATIONS') || 1),
    });
  }

  txUrl(hash: string) {
    return `${CHAINS[this.mode].explorer}/tx/${hash}`;
  }

  // ── contract operations (wallet = the project's ProjectWallet address) ─────
  submitRequest(wallet: string, a: { invoiceId: string; supplier: string; amountCents: number | bigint; documentSha256: string; milestoneId?: string | null }, onSent?: (hash: string) => Promise<unknown>) {
    return this.send(wallet, 'submitPaymentRequest', [
      chainKey(a.invoiceId), a.supplier, BigInt(a.amountCents), '0x' + a.documentSha256,
      a.milestoneId ? chainKey(a.milestoneId) : ZeroHash,
    ], onSent);
  }
  approve(wallet: string, invoiceId: string, onSent?: (h: string) => Promise<unknown>) { return this.send(wallet, 'approvePayment', [chainKey(invoiceId)], onSent); }
  reject(wallet: string, invoiceId: string, onSent?: (h: string) => Promise<unknown>) { return this.send(wallet, 'rejectPayment', [chainKey(invoiceId)], onSent); }
  release(wallet: string, invoiceId: string, onSent?: (h: string) => Promise<unknown>) { return this.send(wallet, 'releasePayment', [chainKey(invoiceId)], onSent); }
  registerMilestone(wallet: string, milestoneId: string, onSent?: (h: string) => Promise<unknown>) { return this.send(wallet, 'registerMilestone', [chainKey(milestoneId)], onSent); }
  verifyMilestone(wallet: string, milestoneId: string, onSent?: (h: string) => Promise<unknown>) { return this.send(wallet, 'verifyMilestone', [chainKey(milestoneId)], onSent); }

  async balance(wallet: string) {
    await this.ensureReady();
    const [balance, available] = await this.contract(wallet).getBalance();
    return { balanceCents: BigInt(balance), availableCents: BigInt(available) };
  }

  /** Read-only production preflight; never signs or broadcasts. */
  async readiness(wallet: string, projectId: string) {
    await this.ensureReady();
    const signer = await this.signer.getAddress();
    const view = new Contract(wallet, [
      'function projectId() view returns(bytes32)', 'function allocated() view returns(uint256)',
      'function token() view returns(address)', 'function hasRole(bytes32,address) view returns(bool)',
    ], this.provider);
    const [project, allocated, token, municipality, approver, gas, balance] = await Promise.all([
      view.projectId(), view.allocated(), view.token(), view.hasRole(keccak256(toUtf8Bytes('MUNICIPALITY_ROLE')),signer),
      view.hasRole(keccak256(toUtf8Bytes('APPROVER_ROLE')),signer), this.provider.getBalance(signer), this.balance(wallet),
    ]);
    return { ready: project === chainKey(projectId) && municipality && approver && gas > 0n,
      mode:this.mode, chain_id:this.expectedChainId, signer_address:signer, wallet_address:wallet,
      token_address:token, project_matches:project===chainKey(projectId), has_municipality_role:Boolean(municipality),
      has_approver_role:Boolean(approver), gas_balance_wei:gas.toString(), allocated_cents:allocated.toString(),
      balance_cents:balance.balanceCents.toString(), available_cents:balance.availableCents.toString() };
  }

  /** Reconciles a pending transaction by its hash. */
  async receipt(hash: string): Promise<ChainResult> {
    await this.ensureReady();
    const r = await this.provider.getTransactionReceipt(hash);
    if (r) {
      if ((await this.provider.getBlockNumber()) - r.blockNumber + 1 < this.confirmations) return { status: 'pending', txHash: hash };
      return r.status === 1
        ? { status: 'confirmed', txHash: hash, blockNumber: r.blockNumber }
        : { status: 'failed', txHash: hash, blockNumber: r.blockNumber, error: 'REVERTED' };
    }
    // A temporarily missing hash is not proof that a broadcast failed.
    return { status: 'pending', txHash: hash };
  }

  // ── internals ──────────────────────────────────────────────────────────────
  private contract(address: string) {
    if (!/^0x[0-9a-fA-F]{40}$/.test(address)) throw new Error(`Invalid wallet address ${address}`);
    return new Contract(address, PROJECT_WALLET_ABI as never, this.signer);
  }

  private ensureReady() {
    this.ready ??= (async () => {
      const chainId = parseInt(await this.provider.send('eth_chainId', []), 16);
      if (chainId !== this.expectedChainId) {
        throw new Error(`RPC is chain ${chainId}, expected ${this.expectedChainId} for ${this.mode}`);
      }
    })().catch((e) => { this.ready = undefined; throw e; });
    return this.ready;
  }

  private async send(wallet: string, method: string, args: unknown[], onSent?: (hash: string) => Promise<unknown>): Promise<ChainResult> {
    await this.ensureReady();
    const c = this.contract(wallet);
    try {
      await c[method].staticCall(...args);
    } catch (e) {
      const name = revertName(e);
      if (name) return { status: 'failed', error: errorCode(name), detail: name };
      throw e; // RPC unreachable etc.: nothing was sent
    }
    let raw: string;
    try {
      const request = await c[method].populateTransaction(...args);
      raw = await this.signer.signTransaction(await this.signer.populateTransaction(request));
    } catch (e) {
      const name = revertName(e);
      if (name) return { status: 'failed', error: errorCode(name), detail: name };
      throw e;
    }
    // Persist the deterministic hash BEFORE broadcasting. If persistence fails,
    // do not send and do not roll back a record whose commit outcome is unknown.
    const hash = keccak256(raw);
    if (onSent) {
      try { await onSent(hash); }
      catch { return { status: 'pending', detail: 'Hash persistence requires reconciliation; nothing was broadcast by this attempt.' }; }
    }
    let tx;
    try { tx = await this.provider.broadcastTransaction(raw); }
    catch { return { status: 'pending', txHash: hash, detail: 'Broadcast outcome unknown; reconcile this hash before retrying.' }; }
    try {
      const r = await tx.wait(this.confirmations, this.timeoutMs);
      if (!r) return { status: 'pending', txHash: tx.hash };
      return r.status === 1
        ? { status: 'confirmed', txHash: tx.hash, blockNumber: r.blockNumber }
        : { status: 'failed', txHash: tx.hash, blockNumber: r.blockNumber, error: 'REVERTED' };
    } catch (e) {
      // deno-lint-ignore no-explicit-any
      if ((e as any)?.code === 'CALL_EXCEPTION') {
        const name = revertName(e);
        return { status: 'failed', txHash: tx.hash, error: name ? errorCode(name) : 'REVERTED' };
      }
      // TIMEOUT or a dropped connection: the transaction may still be mined.
      return { status: 'pending', txHash: tx.hash, detail: String((e as Error)?.message ?? e).split('\n')[0] };
    }
  }
}

// deno-lint-ignore no-explicit-any
function revertName(e: any): string | undefined {
  return e?.revert?.name ?? undefined;
}
