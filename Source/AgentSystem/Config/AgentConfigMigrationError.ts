import { AgentBaseError } from "../Core/AgentBaseError.js";

export class AgentConfigMigrationError extends AgentBaseError {
  constructor(message: string) {
    super(message);
  }
}
