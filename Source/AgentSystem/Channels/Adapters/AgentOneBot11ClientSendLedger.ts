import { AsyncLocalStorage } from "node:async_hooks";
import { createHash } from "node:crypto";
import { z } from "zod";
import { stringifyAgentCanonicalJson } from "../../Core/AgentCanonicalJson.js";
import {
  AgentOneBot11ClientMessageIdParam,
  AgentOneBot11SendActions,
} from "../Client/AgentOneBot11ReliabilityContract.js";
import type { AgentOneBot11MessageStore } from "./AgentOneBot11MessageStore.js";

export interface OneBotClientSendIdentity {
  readonly id: string;
  readonly digest: string;
}

/** The receipt commits in the same SQLite transaction as its accepted message. */
export class AgentOneBot11ClientSendLedger {
  private readonly context = new AsyncLocalStorage<OneBotClientSendIdentity>();
  private readonly running = new Map<string, { digest: string; promise: Promise<Record<string, unknown>> }>();

  constructor(private readonly store: () => AgentOneBot11MessageStore) {}

  get current(): OneBotClientSendIdentity | undefined {
    return this.context.getStore();
  }

  async run(
    action: string,
    params: Record<string, unknown> | undefined,
    execute: () => Promise<Record<string, unknown>>,
  ) {
    if (!AgentOneBot11SendActions.has(action) || params?.[AgentOneBot11ClientMessageIdParam] === undefined)
      return execute();
    const id = z.uuid().parse(params[AgentOneBot11ClientMessageIdParam]);
    const { [AgentOneBot11ClientMessageIdParam]: _id, ...body } = params;
    const digest = createHash("sha256")
      .update(stringifyAgentCanonicalJson({ action, params: body }))
      .digest("hex");
    const accepted = this.store().clientSend(id);
    const active = this.running.get(id);
    const previous = accepted ?? active;
    if (previous && previous.digest !== digest)
      throw new Error("A client message ID cannot be reused for different content or recipients.");
    if (accepted) return { status: "ok", retcode: 0, data: { message_id: Number(accepted.messageId) } };
    if (active) return active.promise;
    const promise = this.context.run({ id, digest }, execute).finally(() => this.running.delete(id));
    this.running.set(id, { digest, promise });
    return promise;
  }
}
