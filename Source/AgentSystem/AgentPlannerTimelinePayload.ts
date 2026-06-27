export const AgentPlannerTimelinePayloadKeys = {
  Message: "message",
  UserMessage: "userMessage",
  Calls: "calls",
  Observations: "observations",
  XmlRoot: "xmlRoot",
  Value: "value",
} as const;

export function encodePlannerTimelinePayload(value: unknown): string {
  const encoded = JSON.stringify(value);
  if (encoded === undefined) {
    throw new Error("Planner timeline payload is not JSON serializable.");
  }
  return encoded;
}

export function decodePlannerTimelinePayload(value: string | undefined): unknown | undefined {
  if (!value) {
    return undefined;
  }

  return JSON.parse(value) as unknown;
}
