/**
 * The WalletService contract between P2's API and P3's wallet implementations.
 *
 * Every id passed in is a UUID string from Supabase. Implementations derive their
 * own keys from it (the chain uses keccak256(utf8(uuid))). Money is always integer
 * cents as bigint: R2,000,000.00 = 200000000n.
 *
 * Mutations never throw for rule violations: they return a TxResult with
 * status 'failed' and an `error` code, so the API can map it to a 409.
 * They only throw WalletError for configuration problems (bad env, unknown project
 * lookups the API should never make).
 */

export type WalletMode = "simulated" | "fuji" | "bsc";
export type TxStatus = "pending" | "confirmed" | "failed";

export interface TxResult {
  mode: WalletMode;
  /** 'sim_<uuid>' in simulated mode, the 0x… transaction hash on chain, '' if nothing was sent */
  txHash: string;
  /**
   * confirmed: the change is final.
   * pending:   sent but not yet confirmed (e.g. RPC timeout). Store the hash and
   *            reconcile later with getTxStatus(); NEVER treat this as failed.
   * failed:    rejected by the wallet rules or reverted; nothing changed.
   */
  status: TxStatus;
  blockNumber?: number;
  /** Set when status is 'failed', e.g. 'MILESTONE_NOT_VERIFIED'. See WalletErrorCode. */
  error?: WalletErrorCode;
  /** Extra context for logs, e.g. the request's current status for INVALID_STATUS. */
  detail?: string;
}

/** Same codes in every mode, mirroring the Solidity custom errors. */
export type WalletErrorCode =
  | "PROJECT_ALREADY_EXISTS"
  | "PROJECT_NOT_FOUND"
  | "INVALID_AMOUNT"
  | "INVALID_ADDRESS"
  | "INVALID_HASH"
  | "EXCEEDS_ALLOCATION"
  | "REQUEST_ALREADY_EXISTS"
  | "REQUEST_NOT_FOUND"
  | "INVALID_STATUS"
  | "INSUFFICIENT_AVAILABLE"
  | "MILESTONE_ALREADY_REGISTERED"
  | "MILESTONE_NOT_FOUND"
  | "MILESTONE_ALREADY_VERIFIED"
  | "MILESTONE_NOT_VERIFIED"
  | "UNAUTHORIZED"
  | "INSUFFICIENT_TOKENS"
  | "REVERTED"
  | "UNKNOWN";

export type RequestStatus = "pending" | "approved" | "rejected" | "released";
export type MilestoneStatus = "none" | "registered" | "verified";

export interface PaymentRequestView {
  invoiceId: string;
  projectId: string;
  supplierAddress: string;
  amountCents: bigint;
  /** 64 lowercase hex chars, no 0x */
  documentSha256: string;
  /** True if release waits for a verified milestone. (The chain only stores the
   *  milestone's hash, so the milestone's uuid comes from the API's own invoices row.) */
  milestoneLinked: boolean;
  status: RequestStatus;
}

export interface Balance {
  /** Tokens held for the project */
  balanceCents: bigint;
  /** Balance minus approved-but-unpaid amounts */
  availableCents: bigint;
}

export interface WalletService {
  readonly mode: WalletMode;

  /** Creates the project's ring-fenced wallet (on chain: a new ProjectWallet via the factory). */
  createProject(projectId: string, allocatedCents: bigint): Promise<TxResult>;
  /** Deposits dZAR into the project, never beyond its allocation. */
  fundProject(projectId: string, amountCents: bigint): Promise<TxResult>;

  /** Registers an invoice and anchors its document hash. One request per invoice. */
  submitPaymentRequest(
    invoiceId: string,
    projectId: string,
    supplierAddress: string,
    amountCents: bigint,
    documentSha256: string,
    milestoneId?: string | null,
  ): Promise<TxResult>;
  /** Commits funds to a pending request. Hold is API-only: never call the wallet for it. */
  approvePayment(invoiceId: string): Promise<TxResult>;
  rejectPayment(invoiceId: string): Promise<TxResult>;
  /** Pays an approved request to the supplier, exactly once. */
  releasePayment(invoiceId: string): Promise<TxResult>;

  /** Must be called before any invoice can reference the milestone. */
  registerMilestone(milestoneId: string, projectId: string): Promise<TxResult>;
  /** Official verification (never community confirmation). Unlocks dependent payments. */
  verifyMilestone(milestoneId: string): Promise<TxResult>;

  getBalance(projectId: string): Promise<Balance>;
  /** null if the wallet has never seen this invoice. */
  getRequest(invoiceId: string): Promise<PaymentRequestView | null>;
  getMilestoneStatus(milestoneId: string): Promise<MilestoneStatus>;
  /** Reconciles a 'pending' result later. */
  getTxStatus(txHash: string): Promise<TxResult>;
}

/** Thrown only for setup/configuration problems, never for rule violations. */
export class WalletError extends Error {
  constructor(
    public readonly code: WalletErrorCode | "CONFIG",
    message: string,
  ) {
    super(message);
    this.name = "WalletError";
  }
}

export const SHA256_HEX = /^[0-9a-f]{64}$/;
export const EVM_ADDRESS = /^0x[0-9a-fA-F]{40}$/;
