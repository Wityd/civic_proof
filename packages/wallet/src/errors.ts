import type { WalletErrorCode } from "./types";

export const WALLET_ERROR_CODES: readonly WalletErrorCode[] = [
  "PROJECT_ALREADY_EXISTS",
  "PROJECT_NOT_FOUND",
  "INVALID_AMOUNT",
  "INVALID_ADDRESS",
  "INVALID_HASH",
  "EXCEEDS_ALLOCATION",
  "REQUEST_ALREADY_EXISTS",
  "REQUEST_NOT_FOUND",
  "INVALID_STATUS",
  "INSUFFICIENT_AVAILABLE",
  "MILESTONE_ALREADY_REGISTERED",
  "MILESTONE_NOT_FOUND",
  "MILESTONE_ALREADY_VERIFIED",
  "MILESTONE_NOT_VERIFIED",
  "UNAUTHORIZED",
  "INSUFFICIENT_TOKENS",
  "REVERTED",
  "UNKNOWN",
];

export function isWalletErrorCode(value: string): value is WalletErrorCode {
  return (WALLET_ERROR_CODES as readonly string[]).includes(value);
}

/** Solidity custom error name → shared code, e.g. MilestoneNotVerified → MILESTONE_NOT_VERIFIED. */
export function solidityErrorToCode(name: string): WalletErrorCode {
  if (name.startsWith("AccessControl") || name.startsWith("Ownable")) return "UNAUTHORIZED";
  if (name.startsWith("ERC20InsufficientBalance") || name.startsWith("ERC20InsufficientAllowance")) {
    return "INSUFFICIENT_TOKENS";
  }
  const code = name.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toUpperCase();
  return isWalletErrorCode(code) ? code : "REVERTED";
}

/** Contract Status enum index → RequestStatus (0 = None means "not found"). */
export const CHAIN_REQUEST_STATUS = [null, "pending", "approved", "rejected", "released"] as const;
export const CHAIN_MILESTONE_STATUS = ["none", "registered", "verified"] as const;
