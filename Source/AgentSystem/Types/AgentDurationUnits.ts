export const AgentDurationUnits = ["milliseconds", "seconds", "minutes", "hours", "days"] as const;
export type AgentDurationUnit = (typeof AgentDurationUnits)[number];

const SecondsPerUnit: Record<AgentDurationUnit, number> = {
  milliseconds: 0.001,
  seconds: 1,
  minutes: 60,
  hours: 3600,
  days: 86400,
};

export const AgentDisplayDurationUnits = ["seconds", "minutes", "hours", "days"] as const;
export type AgentDisplayDurationUnit = (typeof AgentDisplayDurationUnits)[number];

export function convertAgentDuration(value: number, from: AgentDurationUnit, to: AgentDurationUnit): number {
  return Number(((value * SecondsPerUnit[from]) / SecondsPerUnit[to]).toPrecision(15));
}

export function chooseAgentDisplayDurationUnit(
  value: number | undefined,
  from: AgentDurationUnit,
): AgentDisplayDurationUnit {
  const seconds = value === undefined ? 0 : Math.abs(convertAgentDuration(value, from, "seconds"));
  return [...AgentDisplayDurationUnits].reverse().find((unit) => seconds >= SecondsPerUnit[unit]) ?? "seconds";
}
