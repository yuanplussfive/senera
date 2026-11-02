export const AgentSessionOperations = {
  Message: "session.message",
  Close: "session.close",
  History: "session.history",
  RunHistory: "session.run_history",
  Fork: "session.fork",
  Compact: "session.compact",
  RuntimeStatus: "session.runtime_status",
  Export: "session.export",
} as const;

export type AgentSessionOperation = (typeof AgentSessionOperations)[keyof typeof AgentSessionOperations];
