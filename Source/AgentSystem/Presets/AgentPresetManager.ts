import type { ResolvedAgentPresetsConfig } from "../Types/AgentConfigTypes.js";
import {
  EmptyAgentRoleplayPresetContext,
  type AgentPersonaPreset,
  type AgentPresetOperationResult,
  type AgentPresetSnapshot,
  type AgentPresetSnapshotItem,
  type AgentRoleplayPresetContext,
} from "./AgentPresetTypes.js";
import { AgentPresetParser } from "./AgentPresetParser.js";
import { AgentPresetRepository } from "./AgentPresetRepository.js";
import { selectAgentPresetLore } from "./AgentPresetLoreRetriever.js";
import { errorMessage } from "../Core/AgentErrors.js";
import { applyAgentPresetPromptBudget } from "./AgentPresetPromptBudget.js";
import type { AgentPresetActivationRuntime } from "./AgentPresetActivationRuntime.js";

export interface AgentPresetManagerOptions {
  workspaceRoot: string;
  config: ResolvedAgentPresetsConfig;
  activation?: AgentPresetActivationRuntime;
}

export interface AgentPresetSaveRequest {
  requestId?: string;
  name: string;
  card: AgentPersonaPreset;
  activate?: boolean;
}

export class AgentPresetManager {
  private readonly repository: AgentPresetRepository;
  private readonly parser = new AgentPresetParser();

  constructor(private readonly options: AgentPresetManagerOptions) {
    this.repository = new AgentPresetRepository({
      workspaceRoot: options.workspaceRoot,
      rootDir: options.config.RootDir,
      stateFile: options.config.StateFile,
    });
  }

  async snapshot(operation?: AgentPresetOperationResult): Promise<AgentPresetSnapshot> {
    const [records, state, worldPackages] = await Promise.all([
      this.repository.list(),
      this.repository.readState(),
      this.options.activation?.catalog() ?? Promise.resolve([]),
    ]);
    const presets = records.map((record) => this.projectSnapshotItem(record));
    const activePresetName = presets.some((preset) => preset.name === state.activePresetName && preset.card)
      ? state.activePresetName
      : null;

    return {
      enabled: this.options.config.Enabled,
      rootDir: this.options.config.RootDir,
      activePresetName,
      presets: presets.map((preset) => ({ ...preset, active: preset.name === activePresetName })),
      worldPackages: [...worldPackages],
      operation,
    };
  }

  async save(request: AgentPresetSaveRequest): Promise<AgentPresetSnapshot> {
    const card = this.parser.parseCard(request.card);
    const priorState = await this.repository.readState();
    const priorRecord = await this.repository.readOptional(request.name);
    const priorActiveCard =
      request.activate && priorState.activePresetName
        ? this.parser.parse(await this.repository.read(priorState.activePresetName)).card
        : null;
    const record = await this.repository.save({
      name: request.name,
      card,
    });
    const activatesSavedCard = request.activate || priorState.activePresetName === record.name;
    if (activatesSavedCard) {
      try {
        await this.options.activation?.synchronize(card);
        if (request.activate) await this.repository.writeState({ activePresetName: record.name });
      } catch (error) {
        if (priorRecord) {
          await this.repository.save({ name: priorRecord.name, card: this.parser.parse(priorRecord).card });
        } else {
          await this.repository.delete(record.name);
        }
        if (request.activate) await this.options.activation?.synchronize(priorActiveCard);
        throw error;
      }
    }
    return this.snapshot({
      requestId: request.requestId,
      kind: "save",
      name: record.name,
    });
  }

  async delete(request: { requestId?: string; name: string }): Promise<AgentPresetSnapshot> {
    const state = await this.repository.readState();
    const record = await this.repository.read(request.name);
    const deletesActiveCard = state.activePresetName === record.name;
    if (!deletesActiveCard) {
      await this.repository.delete(record.name);
    } else {
      const card = this.parser.parse(record).card;
      await this.options.activation?.synchronize(null);
      try {
        await this.repository.delete(record.name);
        await this.repository.writeState({ activePresetName: null });
      } catch (error) {
        await this.repository.save({ name: record.name, card });
        await this.options.activation?.synchronize(card);
        throw error;
      }
    }
    return this.snapshot({
      requestId: request.requestId,
      kind: "delete",
      name: request.name,
    });
  }

  async setActive(request: { requestId?: string; name?: string | null }): Promise<AgentPresetSnapshot> {
    const activePresetName = request.name ?? null;
    const nextCard = activePresetName ? this.parser.parse(await this.repository.read(activePresetName)).card : null;
    const priorState = await this.repository.readState();
    const priorCard = priorState.activePresetName
      ? this.parser.parse(await this.repository.read(priorState.activePresetName)).card
      : null;
    await this.options.activation?.synchronize(nextCard);
    try {
      await this.repository.writeState({ activePresetName });
    } catch (error) {
      await this.options.activation?.synchronize(priorCard);
      throw error;
    }
    return this.snapshot({
      requestId: request.requestId,
      kind: "set_active",
      name: activePresetName,
    });
  }

  async synchronizeActivePreset(): Promise<AgentPersonaPreset | null> {
    if (!this.options.activation) return null;
    if (!this.options.config.Enabled) {
      await this.options.activation.synchronize(null);
      return null;
    }
    const state = await this.repository.readState();
    const card = state.activePresetName
      ? this.parser.parse(await this.repository.read(state.activePresetName)).card
      : null;
    await this.options.activation.synchronize(card);
    return card;
  }

  async promptContext(userInput = ""): Promise<AgentRoleplayPresetContext> {
    if (!this.options.config.Enabled) {
      return EmptyAgentRoleplayPresetContext;
    }

    const state = await this.repository.readState();
    if (!state.activePresetName) {
      return {
        enabled: true,
        activePresetName: null,
      };
    }

    const record = await this.repository.read(state.activePresetName);
    const parsed = this.parser.parse(record);
    const promptBudget = this.options.config.PromptBudget;
    const selectedLore = selectAgentPresetLore(parsed.card.lore, userInput);
    const supplemental = applyAgentPresetPromptBudget(
      {
        examples: parsed.card.examples.map((example) => ({
          situation: example.situation.trim(),
          reply: example.reply.trim(),
        })),
        lore: selectedLore.map((entry) => ({
          title: entry.title.trim(),
          content: entry.content.trim(),
        })),
      },
      promptBudget,
    );
    return {
      enabled: true,
      activePresetName: record.name,
      card: {
        title: parsed.card.title,
        corePersona: parsed.card.corePersona.trim(),
        languageStyle: parsed.card.languageStyle.trim(),
        examples: [...supplemental.examples],
        lore: [...supplemental.lore],
      },
    };
  }

  private projectSnapshotItem(
    record: Awaited<ReturnType<AgentPresetRepository["list"]>>[number],
  ): AgentPresetSnapshotItem {
    try {
      const parsed = this.parser.parse(record);
      return {
        name: record.name,
        title: parsed.card.title,
        sizeBytes: record.sizeBytes,
        updatedAt: record.updatedAt,
        active: false,
        card: parsed.card,
        diagnostics: [],
      };
    } catch (error) {
      return {
        name: record.name,
        title: fileNameTitle(record.name),
        sizeBytes: record.sizeBytes,
        updatedAt: record.updatedAt,
        active: false,
        diagnostics: [
          {
            severity: "error",
            message: errorMessage(error),
          },
        ],
      };
    }
  }
}

function fileNameTitle(name: string): string {
  return name.replace(/\.json$/iu, "") || name;
}
