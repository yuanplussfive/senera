import { agentErrorMessage } from "../I18n/AgentMessageCatalog.js";

export interface AgentSessionRunControlPolicy {
  readonly settlementTimeoutMs: number;
}

export class AgentSessionRunSettlementTimeoutError extends Error {
  constructor(
    readonly sessionId: string,
    readonly requestId: string,
    readonly timeoutMs: number,
  ) {
    super(agentErrorMessage("session.runSettlementTimeout", { timeoutMs }));
    this.name = "AgentSessionRunSettlementTimeoutError";
  }
}

export async function waitForAgentSessionRunSettlement(options: {
  readonly sessionId: string;
  readonly requestId: string;
  readonly settlement: Promise<void>;
  readonly policy: AgentSessionRunControlPolicy;
}): Promise<void> {
  const timeoutMs = options.policy.settlementTimeoutMs;
  const timeout = createSettlementTimeout(options.sessionId, options.requestId, timeoutMs);
  try {
    await Promise.race([options.settlement, timeout.promise]);
  } finally {
    timeout.dispose();
  }
}

function createSettlementTimeout(
  sessionId: string,
  requestId: string,
  timeoutMs: number,
): { promise: Promise<never>; dispose: () => void } {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new RangeError(`Run settlement timeout must be a positive finite number: ${timeoutMs}`);
  }

  let timer: NodeJS.Timeout | undefined;
  const promise = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(
      () => reject(new AgentSessionRunSettlementTimeoutError(sessionId, requestId, timeoutMs)),
      timeoutMs,
    );
    timer.unref();
  });
  return {
    promise,
    dispose: () => {
      if (timer) clearTimeout(timer);
    },
  };
}
