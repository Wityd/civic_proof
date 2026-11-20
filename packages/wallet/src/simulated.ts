import { isWalletErrorCode } from "./errors";
import {
  Balance,
  MilestoneStatus,
  PaymentRequestView,
  TxResult,
  WalletError,
  WalletService,
} from "./types";

/**
 * The slice of a Supabase client we need. A real `createClient(url, serviceRoleKey)`
 * satisfies it, and so does the PGlite adapter used in tests.
 */
export interface RpcClient {
  rpc(fn: string, args?: Record<string, unknown>): PromiseLike<{ data: any; error: { message: string } | null }>;
}

/**
 * WALLET_MODE=simulated. Same rules as the contracts, enforced inside Postgres by
 * packages/wallet/sql/simulated_wallet.sql. Results confirm instantly with a 'sim_<uuid>' hash.
 * Must be used with the service-role key: the functions are revoked from anon/authenticated.
 */
export class SimulatedWalletService implements WalletService {
  readonly mode = "simulated" as const;

  constructor(private readonly db: RpcClient) {}

  createProject(projectId: string, allocatedCents: bigint) {
    return this.mutate("sim_wallet_create_project", {
      p_project_id: projectId,
      p_allocated_cents: allocatedCents.toString(),
    });
  }

  fundProject(projectId: string, amountCents: bigint) {
    return this.mutate("sim_wallet_fund_project", {
      p_project_id: projectId,
      p_amount_cents: amountCents.toString(),
    });
  }

  submitPaymentRequest(
    invoiceId: string,
    projectId: string,
    supplierAddress: string,
    amountCents: bigint,
    documentSha256: string,
    milestoneId?: string | null,
  ) {
    return this.mutate("sim_wallet_submit_request", {
      p_request_id: invoiceId,
      p_project_id: projectId,
      p_supplier_address: supplierAddress,
      p_amount_cents: amountCents.toString(),
      p_document_sha256: documentSha256,
      p_milestone_id: milestoneId ?? null,
    });
  }

  approvePayment(invoiceId: string) {
    return this.mutate("sim_wallet_approve", { p_request_id: invoiceId });
  }

  rejectPayment(invoiceId: string) {
    return this.mutate("sim_wallet_reject", { p_request_id: invoiceId });
  }

  releasePayment(invoiceId: string) {
    return this.mutate("sim_wallet_release", { p_request_id: invoiceId });
  }

  registerMilestone(milestoneId: string, projectId: string) {
    return this.mutate("sim_wallet_register_milestone", {
      p_milestone_id: milestoneId,
      p_project_id: projectId,
    });
  }

  verifyMilestone(milestoneId: string) {
    return this.mutate("sim_wallet_verify_milestone", { p_milestone_id: milestoneId });
  }

  async getBalance(projectId: string): Promise<Balance> {
    const data = await this.query("sim_wallet_get_balance", { p_project_id: projectId });
    return { balanceCents: BigInt(data.balance_cents), availableCents: BigInt(data.available_cents) };
  }

  async getRequest(invoiceId: string): Promise<PaymentRequestView | null> {
    const data = await this.query("sim_wallet_get_request", { p_request_id: invoiceId });
    if (!data) return null;
    return {
      invoiceId: data.request_id,
      projectId: data.project_id,
      supplierAddress: data.supplier_address,
      amountCents: BigInt(data.amount_cents),
      documentSha256: data.document_sha256,
      milestoneLinked: data.milestone_id != null,
      status: data.status,
    };
  }

  async getMilestoneStatus(milestoneId: string): Promise<MilestoneStatus> {
    return (await this.query("sim_wallet_get_milestone", { p_milestone_id: milestoneId })) as MilestoneStatus;
  }

  async getTxStatus(txHash: string): Promise<TxResult> {
    const data = await this.query("sim_wallet_get_tx", { p_tx_hash: txHash });
    // Simulated operations are atomic: a hash either exists (confirmed) or never happened.
    return data
      ? { mode: this.mode, txHash, status: "confirmed", blockNumber: Number(data.block_number) }
      : { mode: this.mode, txHash, status: "failed", error: "UNKNOWN", detail: "no such simulated transaction" };
  }

  /** Wipes the simulated ledger (for demo:reset). */
  async reset(): Promise<void> {
    await this.query("sim_wallet_reset", {});
  }

  // ── internals ──────────────────────────────────────────────────────────────

  private async mutate(fn: string, args: Record<string, unknown>): Promise<TxResult> {
    const { data, error } = await this.db.rpc(fn, args);
    if (error) {
      const [code, ...rest] = error.message.split(":");
      if (isWalletErrorCode(code)) {
        return { mode: this.mode, txHash: "", status: "failed", error: code, detail: rest.join(":").trim() || undefined };
      }
      // Not a wallet rule: database down, bad uuid, missing migration… The caller must not
      // assume nothing happened, so this throws instead of returning 'failed'.
      throw new WalletError("UNKNOWN", `${fn} failed: ${error.message}`);
    }
    return { mode: this.mode, txHash: data.tx_hash, status: "confirmed", blockNumber: Number(data.block_number) };
  }

  private async query(fn: string, args: Record<string, unknown>): Promise<any> {
    const { data, error } = await this.db.rpc(fn, args);
    if (error) {
      const code = error.message.split(":")[0];
      throw new WalletError(isWalletErrorCode(code) ? code : "UNKNOWN", `${fn} failed: ${error.message}`);
    }
    return data;
  }
}
