/**
 * zod schemas for everything that crosses the gateway boundary: the mandate, HTTP request
 * bodies, and MCP tool inputs. Anything that fails validation is rejected.
 */
import type { Mandate } from "@provn/shared";
import { z } from "zod";

/** 0x-prefixed 20-byte address. Format check only; not an EIP-55 checksum check. */
export const AddressSchema = z
  .string()
  .regex(/^0x[0-9a-fA-F]{40}$/, "must be a 0x-prefixed 20-byte address");

/** Whole-USDC decimal string with at most 6 decimals (the ERC-20 precision), e.g. "0.05". */
export const UsdcAmountSchema = z
  .string()
  .regex(/^\d+(\.\d{1,6})?$/, "must be a decimal USDC amount with at most 6 decimals");

export const MandateSchema = z.object({
  taskId: z.string().min(1),
  purpose: z.string().min(1),
  maxTotalUsdc: UsdcAmountSchema,
  allowedVendors: z.array(z.string().min(1)),
  expiresAt: z.iso.datetime(),
}) satisfies z.ZodType<Mandate>;

/** POST /tasks */
export const CreateTaskBodySchema = z.object({
  userRequest: z.string().min(1).max(4000),
});

/** POST /approvals/:id/approve */
export const ApproveBodySchema = z.object({
  paymentHash: z.string().min(1),
  approvedBy: z.string().min(1),
});

/** MCP tool `pay(recipient, amount, memo)` */
export const PayInputSchema = z.object({
  recipient: AddressSchema,
  amount: UsdcAmountSchema,
  memo: z.string().max(200).optional(),
});

/** MCP tool `fetch_paid_data(url)` */
export const FetchInputSchema = z.object({
  url: z.url({ protocol: /^https?$/ }),
});
