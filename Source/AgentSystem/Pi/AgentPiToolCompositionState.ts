import type { SessionManager } from "@earendil-works/pi-coding-agent";
import { z } from "zod";
import type {
  AgentToolCompositionState,
  AgentToolCompositionStoreWrites,
} from "../ToolRuntime/AgentToolComposition.js";
import { AgentPiSessionCustomEntryTypes } from "./AgentPiSessionEntries.js";

const EntryType = AgentPiSessionCustomEntryTypes.CodemodeStore;
const WritesSchema = z.object({ set: z.record(z.string(), z.unknown()), delete: z.array(z.string()) }).strict();

/** Replay only the current Pi branch; compaction does not erase its custom entries. */
export class AgentPiToolCompositionState implements AgentToolCompositionState {
  constructor(private readonly session: SessionManager) {}

  read(): Readonly<Record<string, unknown>> {
    const state: Record<string, unknown> = Object.create(null);
    for (const entry of this.session.getBranch()) {
      if (entry.type !== "custom" || entry.customType !== EntryType) continue;
      const writes = WritesSchema.parse(entry.data);
      for (const key of writes.delete) delete state[key];
      Object.assign(state, writes.set);
    }
    return state;
  }

  commit(writes: AgentToolCompositionStoreWrites): void {
    if (writes.delete.length === 0 && Object.keys(writes.set).length === 0) return;
    this.session.appendCustomEntry(EntryType, WritesSchema.parse(writes));
  }
}
