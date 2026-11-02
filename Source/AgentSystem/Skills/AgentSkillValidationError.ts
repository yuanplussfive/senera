import type { AgentExtensionDiagnostic } from "../ManagedExtensions/AgentExtensionDiagnostic.js";
import { AgentBaseError } from "../Core/AgentBaseError.js";

export class AgentSkillValidationError extends AgentBaseError {
  constructor(
    message: string,
    readonly diagnostics: readonly AgentExtensionDiagnostic[],
  ) {
    super(message);
  }
}
