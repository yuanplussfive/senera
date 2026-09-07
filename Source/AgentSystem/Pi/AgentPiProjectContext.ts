import {
  isMissingFileError,
  readRegularTextFileSnapshotSync,
  type AgentRegularTextFileSnapshot,
} from "../Core/AgentFs.js";
import { sha256Hex } from "../Core/AgentHash.js";

export interface AgentPiProjectContextSnapshot {
  readonly filePath: string;
  readonly content?: string;
  readonly fingerprint: string;
}

export class AgentPiProjectContext {
  private fileSnapshot: AgentRegularTextFileSnapshot | undefined;
  private current: AgentPiProjectContextSnapshot;

  constructor(private readonly filePath: string) {
    this.current = this.absentSnapshot();
  }

  refresh(): AgentPiProjectContextSnapshot {
    try {
      this.fileSnapshot = readRegularTextFileSnapshotSync(this.filePath, "Pi project context", this.fileSnapshot);
      this.current = {
        filePath: this.filePath,
        content: this.fileSnapshot.content,
        fingerprint: sha256Hex(JSON.stringify({ present: true, content: this.fileSnapshot.content })),
      };
    } catch (error) {
      if (!isMissingFileError(error)) throw error;
      this.fileSnapshot = undefined;
      this.current = this.absentSnapshot();
    }
    return this.current;
  }

  agentsFiles(): { agentsFiles: Array<{ path: string; content: string }> } {
    return {
      agentsFiles:
        this.current.content === undefined ? [] : [{ path: this.current.filePath, content: this.current.content }],
    };
  }

  private absentSnapshot(): AgentPiProjectContextSnapshot {
    return {
      filePath: this.filePath,
      fingerprint: sha256Hex(JSON.stringify({ present: false })),
    };
  }
}
