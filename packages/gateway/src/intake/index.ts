import type { Mandate, Task } from "@provn/shared";
import type { Ledger } from "../ledger/index.js";
import { newId, sha256Hex } from "../util.js";
import { MandateSchema } from "../validation.js";

/** Turns a trusted user request into a task with a mandate. */
export interface Intake {
  /** Record the request as a `trusted` ledger entry, extract a mandate, and store the task. */
  createTask(userRequest: string): Promise<Task>;
  getTask(taskId: string): Task | undefined;
  /** Work out what the user authorized. Reads the user's request only, never outside content. */
  extractMandate(taskId: string, userRequest: string): Promise<Mandate>;
}

export class StubIntake implements Intake {
  // TODO: persist tasks in SQLite so they survive a gateway restart.
  private readonly tasks = new Map<string, Task>();

  constructor(private readonly ledger: Ledger) {}

  async createTask(userRequest: string): Promise<Task> {
    const id = newId("task");
    const createdAt = new Date().toISOString();

    // The user's own words are the one fully trusted input.
    this.ledger.append({
      id: newId("led"),
      source: "user",
      origin: null,
      trust: "trusted",
      contentHash: sha256Hex(userRequest),
      content: userRequest,
      createdAt,
      taskId: id,
    });

    const mandate = MandateSchema.parse(await this.extractMandate(id, userRequest));
    const task: Task = { id, userRequest, mandate, createdAt };
    this.tasks.set(id, task);
    return task;
  }

  getTask(taskId: string): Task | undefined {
    return this.tasks.get(taskId);
  }

  async extractMandate(taskId: string, userRequest: string): Promise<Mandate> {
    // TODO: extract purpose, max total, and allowed vendors from `userRequest`
    // (an LLM call with a strict output schema, validated by MandateSchema).
    // Until then the mandate allows nothing: zero budget and no vendors.
    return {
      taskId,
      purpose: userRequest.slice(0, 200),
      maxTotalUsdc: "0",
      allowedVendors: [],
      expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    };
  }
}
