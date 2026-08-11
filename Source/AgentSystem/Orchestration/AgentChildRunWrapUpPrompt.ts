export function renderAgentChildRunWrapUpInstruction(): string {
  return [
    "The child-run soft deadline has been reached.",
    "Stop investigating and do not start any new Tool calls or delegate more work.",
    "Wait only for Tool calls already in progress, then return the best concise final answer supported by the evidence collected so far.",
    "State material uncertainty or unfinished work explicitly instead of continuing the investigation.",
  ].join(" ");
}
