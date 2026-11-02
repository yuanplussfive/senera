/** Namespaced additions; ordinary OneBot 11 clients continue using standard actions. */
export const AgentOneBot11ClientMessageIdParam = "senera_client_message_id";
export const AgentOneBot11SendActions: ReadonlySet<string> = new Set([
  "send_msg",
  "send_private_msg",
  "send_group_msg",
]);
