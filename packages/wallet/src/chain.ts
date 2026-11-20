import {
  Contract,
  Interface,
  InterfaceAbi,
  JsonRpcProvider,
  NonceManager,
  Wallet,
  ZeroAddress,
  ZeroHash,
  keccak256,
  toUtf8Bytes,
} from "ethers";
import DemoZARAbi from "../../shared/abi/DemoZAR.json";
import FactoryAbi from "../../shared/abi/CivicProofFactory.json";
import ProjectWalletAbi from "../../shared/abi/ProjectWallet.json";
import { CHAIN_MILESTONE_STATUS, CHAIN_REQUEST_STATUS, solidityErrorToCode } from "./errors";
import {
  Balance,
  EVM_ADDRESS,
  MilestoneStatus,
  PaymentRequestView,
  SHA256_HEX,
  TxResult,
  WalletError,
  WalletService,
} from "./types";

export type ChainMode = "fuji" | "bsc";

export const CHAINS: Record<ChainMode, { chainId: number; label: string; explorer: string; deployment: string }> = {
  fuji: { chainId: 43113, label: "Avalanche Fuji", explorer: "https://testnet.snowtrace.io", deployment: "fuji" },
  bsc: { chainId: 97, label: "BNB Smart Chain testnet", explorer: "https://testnet.bscscan.com", deployment: "bscTestnet" },
};

export interface ChainWalletConfig {
  mode: ChainMode;
  rpcUrl: string;
  /** Server-side deployer key: holds MUNICIPALITY + APPROVER roles and mints dZAR. */
  privateKey: string;
  factoryAddress: string;
  tokenAddress: string;
  /**
   * Which project an invoice or milestone belongs to. The API answers from Supabase
   * (invoices.project_id / milestones.project_id). Only called when not already cached.
   */
  resolveProjectId: (kind: "invoice" | "milestone", id: string) => Promise<string>;
  /** Blocks to wait for. Default 1. */
  confirmations?: number;
  /** After this, a sent tx is reported as 'pending' (never 'failed'). Default 60 s. */
  txTimeoutMs?: number;
  /** Override for local tests (Hardhat node = 31337). Defaults to the mode's chain id. */
  chainId?: number;
}

/** On-chain ids: keccak256(utf8(uuid)), identical to the contracts' scripts. */
export const chainId = (uuid: string) => keccak256(toUtf8Bytes(uuid));

// One interface holding every custom error from every contract, so a revert from a
// ProjectWallet deployed inside a factory call still decodes.
const ALL_ERRORS = new Interface(
  dedupe([...(DemoZARAbi as any[]), ...(FactoryAbi as any[]), ...(ProjectWalletAbi as any[])].filter((f) => f.type === "error")),
);

/**
 * WALLET_MODE=fuji | bsc. The same CivicProofFactory + ProjectWallet contracts on either chain.
 */
export class ChainWalletService implements WalletService {
  readonly mode: ChainMode;
  readonly explorer: string;

  private readonly provider: JsonRpcProvider;
  private readonly signer: NonceManager;
  private readonly factory: Contract;
  private readonly token: Contract;
  private readonly confirmations: number;
  private readonly timeoutMs: number;
  private readonly expectedChainId: number;

  private ready?: Promise<void>;
  private queue: Promise<unknown> = Promise.resolve();
  private readonly walletAddressByProject = new Map<string, string>();
  private readonly projectByInvoice = new Map<string, string>();
  private readonly projectByMilestone = new Map<string, string>();

  constructor(private readonly cfg: ChainWalletConfig) {
    if (!CHAINS[cfg.mode]) throw new WalletError("CONFIG", `Unknown chain mode ${cfg.mode}`);
    if (!cfg.privateKey) throw new WalletError("CONFIG", "DEPLOYER_PRIVATE_KEY is not set");
    if (!EVM_ADDRESS.test(cfg.factoryAddress)) throw new WalletError("CONFIG", "Factory address is missing or invalid");
    if (!EVM_ADDRESS.test(cfg.tokenAddress)) throw new WalletError("CONFIG", "DemoZAR address is missing or invalid");

    this.mode = cfg.mode;
    this.explorer = CHAINS[cfg.mode].explorer;
    this.expectedChainId = cfg.chainId ?? CHAINS[cfg.mode].chainId;
    this.confirmations = cfg.confirmations ?? 1;
    this.timeoutMs = cfg.txTimeoutMs ?? 60_000;
    this.provider = new JsonRpcProvider(cfg.rpcUrl);
    this.signer = new NonceManager(new Wallet(cfg.privateKey, this.provider));
    this.factory = new Contract(cfg.factoryAddress, FactoryAbi as InterfaceAbi, this.signer);
    this.token = new Contract(cfg.tokenAddress, DemoZARAbi as InterfaceAbi, this.signer);
  }

  /** Explorer link for a transaction hash. */
  txUrl(txHash: string) {
    return `${this.explorer}/tx/${txHash}`;
  }

  // ── WalletService ──────────────────────────────────────────────────────────

  async createProject(projectId: string, allocatedCents: bigint): Promise<TxResult> {
    const result = await this.send(this.factory, "createProject", [chainId(projectId), allocatedCents]);
    return result;
  }

  async fundProject(projectId: string, amountCents: bigint): Promise<TxResult> {
    const wallet = await this.walletFor(projectId);
    if (!wallet) return this.fail("PROJECT_NOT_FOUND");
    const me = await this.signer.getAddress();
    const walletAddress = await wallet.getAddress();

    // dZAR is simulated: the deployer mints exactly what is missing, then approves the wallet.
    const have: bigint = await this.token.balanceOf(me);
    if (have < amountCents) {
      const mint = await this.send(this.token, "mint", [me, amountCents - have]);
      if (mint.status !== "confirmed") return mint;
    }
    const allowance: bigint = await this.token.allowance(me, walletAddress);
    if (allowance < amountCents) {
      const approve = await this.send(this.token, "approve", [walletAddress, amountCents]);
      if (approve.status !== "confirmed") return approve;
    }
    return this.send(wallet, "fundProject", [amountCents]);
  }

  async submitPaymentRequest(
    invoiceId: string,
    projectId: string,
    supplierAddress: string,
    amountCents: bigint,
    documentSha256: string,
    milestoneId?: string | null,
  ): Promise<TxResult> {
    if (!EVM_ADDRESS.test(supplierAddress) || supplierAddress.toLowerCase() === ZeroAddress) {
      return this.fail("INVALID_ADDRESS");
    }
    if (!SHA256_HEX.test(documentSha256)) return this.fail("INVALID_HASH");
    const wallet = await this.walletFor(projectId);
    if (!wallet) return this.fail("PROJECT_NOT_FOUND");

    const result = await this.send(wallet, "submitPaymentRequest", [
      chainId(invoiceId),
      supplierAddress,
      amountCents,
      "0x" + documentSha256,
      milestoneId ? chainId(milestoneId) : ZeroHash,
    ]);
    if (result.status !== "failed") this.projectByInvoice.set(invoiceId, projectId);
    return result;
  }

  approvePayment(invoiceId: string) {
    return this.onInvoice(invoiceId, "approvePayment");
  }

  rejectPayment(invoiceId: string) {
    return this.onInvoice(invoiceId, "rejectPayment");
  }

  releasePayment(invoiceId: string) {
    return this.onInvoice(invoiceId, "releasePayment");
  }

  async registerMilestone(milestoneId: string, projectId: string): Promise<TxResult> {
    const wallet = await this.walletFor(projectId);
    if (!wallet) return this.fail("PROJECT_NOT_FOUND");
    const result = await this.send(wallet, "registerMilestone", [chainId(milestoneId)]);
    if (result.status !== "failed") this.projectByMilestone.set(milestoneId, projectId);
    return result;
  }

  async verifyMilestone(milestoneId: string): Promise<TxResult> {
    const wallet = await this.walletForMilestone(milestoneId);
    if (!wallet) return this.fail("MILESTONE_NOT_FOUND");
    return this.send(wallet, "verifyMilestone", [chainId(milestoneId)]);
  }

  async getBalance(projectId: string): Promise<Balance> {
    const wallet = await this.walletFor(projectId);
    if (!wallet) throw new WalletError("PROJECT_NOT_FOUND", `No wallet for project ${projectId}`);
    const [balanceCents, availableCents]: [bigint, bigint] = await wallet.getBalance();
    return { balanceCents, availableCents };
  }

  async getRequest(invoiceId: string): Promise<PaymentRequestView | null> {
    const projectId = await this.projectOfInvoice(invoiceId);
    const wallet = projectId ? await this.walletFor(projectId) : null;
    if (!projectId || !wallet) return null;
    try {
      const r = await wallet.getTransaction(chainId(invoiceId));
      const status = CHAIN_REQUEST_STATUS[Number(r.status)];
      if (!status) return null;
      return {
        invoiceId,
        projectId,
        supplierAddress: r.supplier,
        amountCents: r.amount,
        documentSha256: String(r.invoiceHash).slice(2).toLowerCase(),
        milestoneLinked: r.milestoneId !== ZeroHash,
        status,
      };
    } catch (err) {
      if (decodeRevert(err) === "RequestNotFound") return null;
      throw err;
    }
  }

  async getMilestoneStatus(milestoneId: string): Promise<MilestoneStatus> {
    const wallet = await this.walletForMilestone(milestoneId);
    if (!wallet) return "none";
    return CHAIN_MILESTONE_STATUS[Number(await wallet.milestoneStatus(chainId(milestoneId)))] ?? "none";
  }

  async getTxStatus(txHash: string): Promise<TxResult> {
    await this.ensureReady();
    const receipt = await this.provider.getTransactionReceipt(txHash);
    if (receipt) {
      return receipt.status === 1
        ? { mode: this.mode, txHash, status: "confirmed", blockNumber: receipt.blockNumber }
        : { mode: this.mode, txHash, status: "failed", error: "REVERTED", blockNumber: receipt.blockNumber };
    }
    const tx = await this.provider.getTransaction(txHash);
    return tx
      ? { mode: this.mode, txHash, status: "pending" }
      : { mode: this.mode, txHash, status: "failed", error: "UNKNOWN", detail: "transaction not found" };
  }

  // ── internals ──────────────────────────────────────────────────────────────

  private ensureReady() {
    this.ready ??= (async () => {
      const { chainId: actual } = await this.provider.getNetwork();
      if (Number(actual) !== this.expectedChainId) {
        throw new WalletError(
          "CONFIG",
          `RPC is chain ${actual}, expected ${this.expectedChainId} for WALLET_MODE=${this.mode}`,
        );
      }
    })().catch((err) => {
      this.ready = undefined; // allow a retry after a transient RPC failure
      throw err;
    });
    return this.ready;
  }

  private fail(error: TxResult["error"], detail?: string): TxResult {
    return { mode: this.mode, txHash: "", status: "failed", error, detail };
  }

  private async onInvoice(invoiceId: string, method: string): Promise<TxResult> {
    const projectId = await this.projectOfInvoice(invoiceId);
    const wallet = projectId ? await this.walletFor(projectId) : null;
    if (!wallet) return this.fail("REQUEST_NOT_FOUND");
    return this.send(wallet, method, [chainId(invoiceId)]);
  }

  private async projectOfInvoice(invoiceId: string): Promise<string | null> {
    const cached = this.projectByInvoice.get(invoiceId);
    if (cached) return cached;
    const projectId = await this.cfg.resolveProjectId("invoice", invoiceId).catch(() => null);
    if (projectId) this.projectByInvoice.set(invoiceId, projectId);
    return projectId;
  }

  private async walletForMilestone(milestoneId: string): Promise<Contract | null> {
    let projectId = this.projectByMilestone.get(milestoneId) ?? null;
    if (!projectId) {
      projectId = await this.cfg.resolveProjectId("milestone", milestoneId).catch(() => null);
      if (projectId) this.projectByMilestone.set(milestoneId, projectId);
    }
    return projectId ? this.walletFor(projectId) : null;
  }

  /** The project's own ProjectWallet contract, looked up once from the factory. */
  private async walletFor(projectId: string): Promise<Contract | null> {
    await this.ensureReady();
    let address = this.walletAddressByProject.get(projectId);
    if (!address) {
      address = (await this.factory.walletOf(chainId(projectId))) as string;
      if (address === ZeroAddress) return null;
      this.walletAddressByProject.set(projectId, address);
    }
    return new Contract(address, ProjectWalletAbi as InterfaceAbi, this.signer);
  }

  /**
   * Dry-run, send, wait. One transaction at a time so nonces never collide.
   *  - Rule violation in the dry run → 'failed' with the decoded code, nothing sent, no gas spent.
   *  - Sent but not confirmed in time → 'pending' with the hash (reconcile with getTxStatus).
   *  - Mined but reverted → 'failed' with the hash.
   */
  private send(contract: Contract, method: string, args: unknown[]): Promise<TxResult> {
    const run = async (): Promise<TxResult> => {
      await this.ensureReady();
      try {
        await contract[method].staticCall(...args);
      } catch (err) {
        const name = decodeRevert(err);
        if (name) return this.fail(solidityErrorToCode(name), name);
        throw new WalletError("UNKNOWN", `${method} dry run failed: ${shortMessage(err)}`);
      }

      let tx;
      try {
        tx = await contract[method](...args);
      } catch (err) {
        this.signer.reset(); // resync the nonce from the chain
        const name = decodeRevert(err);
        if (name) return this.fail(solidityErrorToCode(name), name);
        throw new WalletError("UNKNOWN", `${method} could not be sent: ${shortMessage(err)}`);
      }

      try {
        const receipt = await tx.wait(this.confirmations, this.timeoutMs);
        if (!receipt) return { mode: this.mode, txHash: tx.hash, status: "pending" };
        if (receipt.status !== 1) {
          return { mode: this.mode, txHash: tx.hash, status: "failed", error: "REVERTED", blockNumber: receipt.blockNumber };
        }
        return { mode: this.mode, txHash: tx.hash, status: "confirmed", blockNumber: receipt.blockNumber };
      } catch (err: any) {
        if (err?.code === "CALL_EXCEPTION") {
          const name = decodeRevert(err);
          return {
            mode: this.mode,
            txHash: tx.hash,
            status: "failed",
            error: name ? solidityErrorToCode(name) : "REVERTED",
            blockNumber: err?.receipt?.blockNumber,
          };
        }
        // TIMEOUT or a dropped RPC connection: the tx may still land. Never report it as failed.
        return { mode: this.mode, txHash: tx.hash, status: "pending", detail: shortMessage(err) };
      }
    };
    const result = this.queue.then(run, run);
    this.queue = result.catch(() => undefined);
    return result;
  }
}

/** Solidity custom error name from an ethers error, or undefined if it isn't a revert. */
function decodeRevert(err: any): string | undefined {
  if (err?.revert?.name) return err.revert.name;
  const data = err?.data ?? err?.info?.error?.data ?? err?.error?.data;
  if (typeof data === "string" && data.length >= 10) {
    try {
      return ALL_ERRORS.parseError(data)?.name;
    } catch {
      return undefined;
    }
  }
  return undefined;
}

function shortMessage(err: any): string {
  return String(err?.shortMessage ?? err?.message ?? err).split("\n")[0];
}

function dedupe(fragments: any[]) {
  const seen = new Set<string>();
  return fragments.filter((f) => {
    const key = `${f.name}(${(f.inputs ?? []).map((i: any) => i.type).join(",")})`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
