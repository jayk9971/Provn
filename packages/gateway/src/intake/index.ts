import type { Mandate, Task } from "@provn/shared";
import type { Ledger } from "../ledger/index.js";
import { newId, sha256Hex } from "../util.js";
import { MandateFormSchema, MandateSchema, type MandateForm } from "../validation.js";

export type { MandateForm } from "../validation.js";

/** How long a task's mandate lasts when the form doesn't say. */
export const DEFAULT_MANDATE_MINUTES = 60;

/** Turns a trusted user request into a task with a mandate. */
export interface Intake {
  /**
   * Record the user's request (and form, if any) as `trusted` ledger entries, build the
   * mandate, and store the task. Throws if the form is invalid.
   */
  createTask(userRequest: string, form?: MandateForm): Promise<Task>;
  getTask(taskId: string): Task | undefined;
}

/**
 * Builds the mandate from explicit fields the user fills in on the dashboard (budget, allowed
 * vendors, expiry), not by having a model read the request. It's predictable on stage, and the
 * fields are the user's own input, so they are trusted.
 *
 * Without a form the mandate allows nothing: zero budget and no vendors. Payments then need
 * the user's approval (or are denied), which is the safe default.
 *
 * We deliberately do NOT guess vendors or a budget from the free-text request: "don't use
 * sketchy.io" would wrongly allow sketchy.io. If you add LLM extraction later, show the result
 * on the dashboard for the user to confirm before it counts.
 */
export class FormIntake implements Intake {
  // TODO: persist tasks in SQLite so they survive a gateway restart.
  private readonly tasks = new Map<string, Task>();

  constructor(
    private readonly ledger: Ledger,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async createTask(userRequest: string, form: MandateForm = {}): Promise<Task> {
    const request = userRequest.trim();
    if (!request) throw new Error("The user's request is empty");
    const fields = MandateFormSchema.parse(form); // validates and normalizes vendors

    const id = newId("task");
    const createdAt = this.now().toISOString();

    // The user's own words are the one fully trusted input. Stored verbatim.
    this.record(id, "user", request, createdAt);

    // The form is the user's input too. Recorded separately (not merged into the request) so
    // trace can find an address or vendor the user typed there.
    const formText = describeForm(fields);
    if (formText) this.record(id, "user:mandate-form", formText, createdAt);

    const minutes = fields.expiresInMinutes ?? DEFAULT_MANDATE_MINUTES;
    const mandate = MandateSchema.parse({
      taskId: id,
      purpose: request.slice(0, 200),
      maxTotalUsdc: fields.budgetUsdc ?? "0",
      allowedVendors: fields.allowedVendors ?? [],
      expiresAt: new Date(this.now().getTime() + minutes * 60_000).toISOString(),
    } satisfies Mandate);

    const task: Task = { id, userRequest: request, mandate, createdAt };
    this.tasks.set(id, task);
    return task;
  }

  getTask(taskId: string): Task | undefined {
    return this.tasks.get(taskId);
  }

  private record(taskId: string, source: string, content: string, createdAt: string): void {
    this.ledger.append({
      id: newId("led"),
      source,
      origin: null,
      trust: "trusted",
      contentHash: sha256Hex(content),
      content,
      createdAt,
      taskId,
    });
  }
}

/** One line per field the user actually filled in. Empty string if none. */
function describeForm(form: MandateForm): string {
  const lines: string[] = [];
  if (form.budgetUsdc !== undefined) lines.push(`Budget: ${form.budgetUsdc} USDC`);
  if (form.allowedVendors?.length) lines.push(`Allowed vendors: ${form.allowedVendors.join(", ")}`);
  return lines.join("\n");
}