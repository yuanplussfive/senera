import { DefaultAgentTimeZone, projectAgentTime, type AgentTimeProjection } from "../Time/AgentTime.js";

export { DefaultAgentTimeZone as DefaultAgentMemoryTimeZone } from "../Time/AgentTime.js";
export type AgentMemoryTimeProjection = AgentTimeProjection;

export function projectMemoryTime(isoText: string): AgentMemoryTimeProjection {
  return projectAgentTime(isoText, DefaultAgentTimeZone);
}
