import type { ResolvedAgentPresetsConfig } from "../Types/AgentConfigTypes.js";
import {
  EmptyAgentRoleplayPresetContext,
  EmptyAgentPlannerRoleplayPresetContext,
  type AgentPresetFormat,
  type AgentPlannerRoleplayPresetContext,
  type AgentPresetOperationResult,
  type AgentPresetSnapshot,
  type AgentPresetSnapshotItem,
  type AgentRoleplayPresetContext,
} from "./AgentPresetTypes.js";
import { AgentPresetParser } from "./AgentPresetParser.js";
import { AgentPresetRepository } from "./AgentPresetRepository.js";
import { AgentPresetXmlProjector } from "./AgentPresetXmlProjector.js";

export interface AgentPresetManagerOptions {
  workspaceRoot: string;
  config: ResolvedAgentPresetsConfig;
}

export interface AgentPresetSaveRequest {
  requestId?: string;
  name: string;
  format: AgentPresetFormat;
  content: string;
  activate?: boolean;
}

export class AgentPresetManager {
  private readonly repository: AgentPresetRepository;
  private readonly parser = new AgentPresetParser();
  private readonly projector = new AgentPresetXmlProjector();

  constructor(private readonly options: AgentPresetManagerOptions) {
    this.repository = new AgentPresetRepository({
      workspaceRoot: options.workspaceRoot,
      rootDir: options.config.RootDir,
      stateFile: options.config.StateFile,
    });
  }

  async snapshot(operation?: AgentPresetOperationResult): Promise<AgentPresetSnapshot> {
    const [records, state] = await Promise.all([
      this.repository.list(),
      this.repository.readState(),
    ]);
    const activePresetName = records.some((record) => record.name === state.activePresetName)
      ? state.activePresetName
      : null;

    return {
      enabled: this.options.config.Enabled,
      rootDir: this.options.config.RootDir,
      activePresetName,
      presets: records.map((record) => this.projectSnapshotItem(record, activePresetName)),
      operation,
    };
  }

  async save(request: AgentPresetSaveRequest): Promise<AgentPresetSnapshot> {
    this.parser.validateContent(request.format, request.content);
    const record = await this.repository.save({
      name: request.name,
      format: request.format,
      content: request.content,
    });
    if (request.activate) {
      await this.repository.writeState({ activePresetName: record.name });
    }
    return this.snapshot({
      requestId: request.requestId,
      kind: "save",
      name: record.name,
    });
  }

  async delete(request: { requestId?: string; name: string }): Promise<AgentPresetSnapshot> {
    await this.repository.delete(request.name);
    const state = await this.repository.readState();
    if (state.activePresetName === request.name) {
      await this.repository.writeState({ activePresetName: null });
    }
    return this.snapshot({
      requestId: request.requestId,
      kind: "delete",
      name: request.name,
    });
  }

  async setActive(request: { requestId?: string; name?: string | null }): Promise<AgentPresetSnapshot> {
    const activePresetName = request.name ?? null;
    if (activePresetName) {
      await this.repository.read(activePresetName);
    }
    await this.repository.writeState({ activePresetName });
    return this.snapshot({
      requestId: request.requestId,
      kind: "set_active",
      name: activePresetName,
    });
  }

  async promptContext(): Promise<AgentRoleplayPresetContext> {
    if (!this.options.config.Enabled) {
      return EmptyAgentRoleplayPresetContext;
    }

    const state = await this.repository.readState();
    if (!state.activePresetName) {
      return {
        enabled: true,
        activePresetName: null,
        documents: [],
      };
    }

    const record = await this.repository.read(state.activePresetName);
    const parsed = this.parser.parse(record);
    return {
      enabled: true,
      activePresetName: record.name,
      documents: [this.projector.projectDocument(parsed)],
    };
  }

  async plannerContext(): Promise<AgentPlannerRoleplayPresetContext> {
    if (!this.options.config.Enabled) {
      return EmptyAgentPlannerRoleplayPresetContext;
    }

    const state = await this.repository.readState();
    if (!state.activePresetName) {
      return {
        enabled: true,
        activePresetName: null,
        documents: [],
      };
    }

    const record = await this.repository.read(state.activePresetName);
    const parsed = this.parser.parse(record);
    return {
      enabled: true,
      activePresetName: record.name,
      documents: [{
        name: record.name,
        format: record.format,
        title: parsed.title,
        updatedAt: record.updatedAt,
        content: this.projectPlannerContent(parsed),
      }],
    };
  }

  private projectSnapshotItem(
    record: Awaited<ReturnType<AgentPresetRepository["list"]>>[number],
    activePresetName: string | null,
  ): AgentPresetSnapshotItem {
    try {
      const parsed = this.parser.parse(record);
      return {
        name: record.name,
        format: record.format,
        title: parsed.title,
        sizeBytes: record.sizeBytes,
        updatedAt: record.updatedAt,
        active: record.name === activePresetName,
        content: record.content,
        diagnostics: [],
      };
    } catch (error) {
      return {
        name: record.name,
        format: record.format,
        title: record.name,
        sizeBytes: record.sizeBytes,
        updatedAt: record.updatedAt,
        active: record.name === activePresetName,
        content: record.content,
        diagnostics: [{
          severity: "error",
          message: error instanceof Error ? error.message : String(error),
        }],
      };
    }
  }

  private projectPlannerContent(
    document: ReturnType<AgentPresetParser["parse"]>,
  ): string {
    if (document.format !== "json") {
      return document.content;
    }

    return JSON.stringify(document.parsedJson, null, 2);
  }
}
