import { z } from "zod";
import { UsdcAmountSchema } from "../validation.js";

const OriginSchema = z.enum(["trusted", "bound", "untrusted", "derived", "unknown"]);

/**
 * Conditions a rule can test. A rule matches when ALL listed conditions hold.
 * An empty `when` always matches (used for the final default rule).
 */
const ConditionSchema = z.strictObject({
  recipient_origin_in: z.array(OriginSchema).optional(),
  recipient_not_bound_to_requested_host: z.boolean().optional(),
  not_in_plan: z.boolean().optional(),
  amount_or_quantity_origin_in: z.array(OriginSchema).optional(),
  recipient_is_new: z.boolean().optional(),
  over_mandate_budget: z.boolean().optional(),
});

const RuleSchema = z.strictObject({
  id: z.string().min(1),
  outcome: z.enum(["allow", "deny", "require_approval"]),
  when: ConditionSchema,
  /** Explanation shown to the user when this rule fires. */
  reason: z.string().min(1),
});

export const PolicyFileSchema = z.strictObject({
  version: z.literal(1),
  /** Hard limits the gateway enforces regardless of rules. The vault enforces them on-chain too. */
  floor: z.strictObject({
    per_tx_max_usdc: UsdcAmountSchema,
    daily_budget_usdc: UsdcAmountSchema,
  }),
  /** Evaluated top to bottom. The first rule that matches decides. */
  rules: z.array(RuleSchema).min(1),
});

export type PolicyFile = z.infer<typeof PolicyFileSchema>;
export type PolicyRule = z.infer<typeof RuleSchema>;
