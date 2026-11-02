import type { AgentDirectoryCommand, AgentDirectorySnapshot, WorkspaceAgent } from "../Core/AgentDirectoryContract.js";
import { AgentDirectory } from "./AgentDirectory.js";

/** Durable deletion intent precedes cleanup; a restart resumes instead of reviving a partially deleted Agent. */
export class AgentDirectoryLifecycle {
  private tail: Promise<unknown> = Promise.resolve();
  constructor(
    private readonly options: {
      directory: AgentDirectory;
      cleanup(agent: WorkspaceAgent): Promise<void>;
    },
  ) {}

  execute(command: AgentDirectoryCommand): Promise<AgentDirectorySnapshot> {
    const result = this.tail.then(async () => {
      const snapshot = this.options.directory.execute(command);
      if (command.type !== "agent.delete") return snapshot;
      await this.options.cleanup(this.options.directory.get(command.id));
      return this.options.directory.completeDeletion(command.id);
    });
    this.tail = result.catch(() => undefined);
    return result;
  }

  async recover(): Promise<void> {
    for (const id of this.options.directory.snapshot().deletingAgentIds) {
      await this.options.cleanup(this.options.directory.get(id));
      this.options.directory.completeDeletion(id);
    }
  }
}
