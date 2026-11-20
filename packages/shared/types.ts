/** Shared backend/frontend and P3 adapter contract. No runtime implementation. */
export type LedgerMode = 'simulated' | 'fuji' | 'bsc';
export type ChainMode = Exclude<LedgerMode, 'simulated'>;
export type TxStatus = 'pending' | 'confirmed' | 'failed';

export interface TxResult {
  mode: LedgerMode;
  txHash: string;
  status: TxStatus;
  blockNumber?: number;
  error?: string;
}

/** Each real project wallet belongs to one chain. Simulation has no EVM address. */
export interface ProjectWalletRecord {
  project_id: string;
  mode: ChainMode;
  wallet_address: string;
  created_at: string;
  updated_at: string;
}

/**
 * One configured mode per running API. The adapter resolves a milestone/invoice
 * UUID to its project, then uses project_wallets(project_id, active mode).
 * IDs on chain are keccak256(UTF-8 lowercase canonical UUID), not UUID bytes.
 */
export interface WalletService {
  createProject(projectId: string, allocatedCents: bigint): Promise<TxResult>;
  fundProject(projectId: string, amountCents: bigint): Promise<TxResult>;
  registerMilestone(milestoneId: string): Promise<TxResult>;
  submitPaymentRequest(
    invoiceId: string,
    projectId: string,
    supplierAddress: string,
    amountCents: bigint,
    documentSha256: string,
    milestoneId?: string,
  ): Promise<TxResult>;
  approvePayment(invoiceId: string): Promise<TxResult>;
  rejectPayment(invoiceId: string): Promise<TxResult>;
  verifyMilestone(milestoneId: string): Promise<TxResult>;
  releasePayment(invoiceId: string): Promise<TxResult>;
  getBalance(projectId: string): Promise<{
    balanceCents: bigint;
    availableCents: bigint;
  }>;
}
