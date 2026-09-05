export const AgentMcpTaskEventPageLimit = 256;

export const AgentMcpProtocol = Object.freeze({
  toolOutputNotification: "notifications/senera/tool-output",
  taskEvents: Object.freeze({
    capability: "senera.task-events",
    version: 1,
    notification: "notifications/senera/task-event",
    read: "senera/tasks/events",
    pageLimit: AgentMcpTaskEventPageLimit,
  }),
});
