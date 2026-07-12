import type { TurnUnderstanding } from "../BamlClient/baml_client/types.js";
import type { AgentTurnUnderstandingEventData } from "../Events/AgentExecutionEventSharedTypes.js";

export function projectTurnUnderstandingForEvent(
  turnUnderstanding: TurnUnderstanding,
): AgentTurnUnderstandingEventData {
  return turnUnderstanding;
}
