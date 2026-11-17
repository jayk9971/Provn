/**
 * zod schemas for everything that crosses the gateway boundary: the mandate, HTTP request
 * bodies, and MCP tool inputs. Anything that fails validation is rejected.
 */
import type { Mandate } from "@provn/shared";
import { z } from "zod";
import { normalizeVendor } from "./util.js";

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

const HOSTNAME = /^(?=.{1,253}$)(localhost|([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63})$/;

/**
 * A vendor the user allows: a host ("paid-api.example") or an address. Normalized (lowercase,
 * no scheme, port or path) so it compares equal to what the policy engine checks.
 */
export const VendorSchema = z
  .string()
  .min(1)
  .max(300)
  .transform(normalizeVendor)
  .refine((v) => /^0x[0-9a-f]{40}$/.test(v) || HOSTNAME.test(v), "must be a host or an address");

/** The mandate fields the user fills in on the dashboard. All optional; missing = allow nothing. */
export const MandateFormSchema = z.object({
  /** Most the task may spend in total, whole USDC. */
  budgetUsdc: UsdcAmountSchema.optional(),
  /** Hosts or addresses the agent may pay without asking. Duplicates are dropped. */
  allowedVendors: z
    .array(VendorSchema)
    .max(20)
    .transform((vendors) => [...new Set(vendors)])
    .optional(),
  /** How long the mandate lasts, 1 minute to 24 hours. */
  expiresInMinutes: z.number().int().min(1).max(1440).optional(),
});

export type MandateForm = z.input<typeof MandateFormSchema>;

/** POST /tasks: the user's request plus the optional mandate form. */
export const CreateTaskBodySchema = MandateFormSchema.extend({
  userRequest: z.string().trim().min(1).max(4000),
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
