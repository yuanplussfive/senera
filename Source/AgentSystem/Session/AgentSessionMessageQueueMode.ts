export const AgentSessionMessageQueueModes = {
  Steer: "steer",
  FollowUp: "follow_up",
} as const;

export const AgentSessionMessageQueueModeValues = [
  AgentSessionMessageQueueModes.Steer,
  AgentSessionMessageQueueModes.FollowUp,
] as const;

export type AgentSessionMessageQueueMode = (typeof AgentSessionMessageQueueModeValues)[number];
