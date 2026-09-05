export const AgentPiBackgroundShutdownPolicy = {
  MaxRetainedFailures: 32,
} as const;

export class AgentPiBackgroundShutdownTracker {
  private readonly operations = new Set<Promise<void>>();
  private readonly failures: unknown[] = [];
  private omittedFailures = 0;

  constructor(private readonly maxRetainedFailures: number = AgentPiBackgroundShutdownPolicy.MaxRetainedFailures) {
    if (!Number.isSafeInteger(maxRetainedFailures) || maxRetainedFailures < 1) {
      throw new RangeError("Background shutdown failure capacity must be a positive safe integer.");
    }
  }

  track(operation: Promise<void>, onFailure?: (error: unknown) => void | Promise<void>): void {
    const tracked = operation
      .catch(async (error: unknown) => {
        this.recordFailure(error);
        try {
          await onFailure?.(error);
        } catch {
          // Failure reporting is observational and must not create a second shutdown failure.
        }
      })
      .finally(() => this.operations.delete(tracked));
    this.operations.add(tracked);
  }

  async drain(): Promise<void> {
    await Promise.all([...this.operations]);
  }

  failureSnapshot(): unknown[] {
    return [
      ...(this.omittedFailures > 0
        ? [new Error(`${this.omittedFailures} earlier Pi background shutdown failures were omitted.`)]
        : []),
      ...this.failures,
    ];
  }

  private recordFailure(error: unknown): void {
    if (this.failures.length >= this.maxRetainedFailures) {
      this.failures.shift();
      this.omittedFailures += 1;
    }
    this.failures.push(error);
  }
}
