import { readAbortMessage } from "../Core/AgentCancellation.js";

export const AgentRunPermitKinds = {
  ReadOnly: "read_only",
  WorkspaceWrite: "workspace_write",
} as const;

export type AgentRunPermitKind = (typeof AgentRunPermitKinds)[keyof typeof AgentRunPermitKinds];

export interface AgentRunConcurrencyLimits {
  readonly maxConcurrentRuns?: number | null;
  readonly maxConcurrentWorkspaceWriters?: number | null;
}

export interface AgentRunPermit {
  release(): void;
}

interface PendingPermit {
  readonly kind: AgentRunPermitKind;
  readonly resolve: (permit: AgentRunPermit) => void;
  readonly reject: (error: Error) => void;
  readonly signal?: AbortSignal;
  onAbort?: () => void;
}

export class AgentRunConcurrencyGate {
  private activeRuns = 0;
  private activeWriters = 0;
  private readonly pending: PendingPermit[] = [];
  private limits: AgentRunConcurrencyLimits;

  constructor(limits: AgentRunConcurrencyLimits = {}) {
    this.limits = {};
    this.updateLimits(limits);
  }

  updateLimits(limits: AgentRunConcurrencyLimits): void {
    assertOptionalPositiveInteger(limits.maxConcurrentRuns, "maxConcurrentRuns");
    assertOptionalPositiveInteger(limits.maxConcurrentWorkspaceWriters, "maxConcurrentWorkspaceWriters");
    if (
      limits.maxConcurrentWorkspaceWriters != null &&
      limits.maxConcurrentRuns != null &&
      limits.maxConcurrentWorkspaceWriters > limits.maxConcurrentRuns
    ) {
      throw new Error("maxConcurrentWorkspaceWriters cannot exceed maxConcurrentRuns.");
    }
    this.limits = { ...limits };
    this.drain();
  }

  acquire(kind: AgentRunPermitKind, signal?: AbortSignal): Promise<AgentRunPermit> {
    if (signal?.aborted) return Promise.reject(new Error(readAbortMessage(signal)));
    if (this.canAcquire(kind) && this.pending.length === 0) return Promise.resolve(this.grant(kind));

    return new Promise<AgentRunPermit>((resolve, reject) => {
      const pending: PendingPermit = { kind, resolve, reject, signal };
      if (signal) {
        pending.onAbort = () => {
          const index = this.pending.indexOf(pending);
          if (index >= 0) this.pending.splice(index, 1);
          reject(new Error(readAbortMessage(signal)));
        };
        signal.addEventListener("abort", pending.onAbort, { once: true });
      }
      this.pending.push(pending);
      this.drain();
    });
  }

  snapshot(): { readonly activeRuns: number; readonly activeWriters: number; readonly queuedRuns: number } {
    return {
      activeRuns: this.activeRuns,
      activeWriters: this.activeWriters,
      queuedRuns: this.pending.length,
    };
  }

  private canAcquire(kind: AgentRunPermitKind): boolean {
    const runLimit = this.limits.maxConcurrentRuns;
    const writerLimit = this.limits.maxConcurrentWorkspaceWriters;
    return (
      (runLimit == null || this.activeRuns < runLimit) &&
      (kind !== AgentRunPermitKinds.WorkspaceWrite || writerLimit == null || this.activeWriters < writerLimit)
    );
  }

  private grant(kind: AgentRunPermitKind): AgentRunPermit {
    this.activeRuns += 1;
    if (kind === AgentRunPermitKinds.WorkspaceWrite) this.activeWriters += 1;
    let released = false;
    return {
      release: () => {
        if (released) return;
        released = true;
        this.activeRuns -= 1;
        if (kind === AgentRunPermitKinds.WorkspaceWrite) this.activeWriters -= 1;
        this.drain();
      },
    };
  }

  private drain(): void {
    for (let index = 0; index < this.pending.length;) {
      const candidate = this.pending[index];
      if (!candidate) return;
      if (candidate.signal?.aborted) {
        this.pending.splice(index, 1);
        candidate.signal.removeEventListener("abort", candidate.onAbort!);
        candidate.reject(new Error(readAbortMessage(candidate.signal)));
        continue;
      }
      if (!this.canAcquire(candidate.kind)) {
        index += 1;
        continue;
      }
      this.pending.splice(index, 1);
      if (candidate.signal && candidate.onAbort) {
        candidate.signal.removeEventListener("abort", candidate.onAbort);
      }
      candidate.resolve(this.grant(candidate.kind));
    }
  }
}

function assertOptionalPositiveInteger(value: number | null | undefined, label: string): void {
  if (value == null) return;
  if (!Number.isSafeInteger(value) || value < 1) throw new Error(`${label} must be a positive safe integer.`);
}
