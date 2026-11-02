import { stringifyAgentCanonicalJson } from "../../../Source/AgentSystem/Core/AgentCanonicalJson";
import { messageDraftRepository } from "./messageDraftRepository";

export class DefinitiveMessageRejection extends Error {}

export interface OutgoingMessage<T, R> {
  id: string;
  payload: T;
  acknowledgement?: { result: R };
}

/** Persist intent before delivery, and acknowledgement before clearing a draft. */
export class DurableMessageOutbox<T, R> {
  private readonly running = new Map<string, { promise: Promise<void>; cancelled: boolean }>();

  constructor(private readonly createId: () => string) {}

  private key(scope: string): string {
    return JSON.stringify(["message-outbox", scope]);
  }

  async prepare(scope: string, payload: T): Promise<void> {
    const fingerprint = stringifyAgentCanonicalJson(payload);
    await messageDraftRepository.update<OutgoingMessage<T, R>[]>(this.key(scope), (previous) => {
      const entries = previous ?? [];
      return entries.some((entry) => stringifyAgentCanonicalJson(entry.payload) === fingerprint)
        ? entries
        : [...entries, { id: this.createId(), payload }];
    });
  }

  read(scope: string): Promise<OutgoingMessage<T, R>[] | undefined> {
    return messageDraftRepository.read(this.key(scope));
  }

  drain(
    scope: string,
    deliver: (entry: OutgoingMessage<T, R>) => Promise<R>,
    accepted: (entry: OutgoingMessage<T, R>) => Promise<void>,
  ): Promise<void> {
    const active = this.running.get(scope);
    if (active && !active.cancelled) return active.promise.then(() => this.drain(scope, deliver, accepted));
    const operation = { cancelled: false, promise: Promise.resolve() };
    operation.promise = this.deliver(scope, deliver, accepted, () => operation.cancelled).finally(() => {
      if (this.running.get(scope) === operation) this.running.delete(scope);
    });
    this.running.set(scope, operation);
    return operation.promise;
  }

  private async deliver(
    scope: string,
    deliver: (entry: OutgoingMessage<T, R>) => Promise<R>,
    accepted: (entry: OutgoingMessage<T, R>) => Promise<void>,
    cancelled: () => boolean,
  ): Promise<void> {
    while (!cancelled()) {
      const entry = (await this.read(scope))?.[0];
      if (!entry || cancelled()) return;
      if (!entry.acknowledgement) {
        try {
          entry.acknowledgement = { result: await deliver(entry) };
        } catch (error) {
          if (error instanceof DefinitiveMessageRejection) await this.remove(scope, entry.id);
          throw error;
        }
        await messageDraftRepository.update<OutgoingMessage<T, R>[]>(this.key(scope), (entries) =>
          entries?.map((value) => (value.id === entry.id ? entry : value)),
        );
      }
      if (cancelled() || !(await this.read(scope))?.some((value) => value.id === entry.id)) continue;
      await accepted(entry);
      await this.remove(scope, entry.id);
    }
  }

  clear(scope: string): Promise<void> {
    const active = this.running.get(scope);
    if (active) active.cancelled = true;
    return messageDraftRepository.write(this.key(scope), undefined);
  }

  private async remove(scope: string, id: string): Promise<void> {
    await messageDraftRepository.update<OutgoingMessage<T, R>[]>(this.key(scope), (entries) => {
      const remaining = entries?.filter((entry) => entry.id !== id);
      return remaining?.length ? remaining : undefined;
    });
  }
}
