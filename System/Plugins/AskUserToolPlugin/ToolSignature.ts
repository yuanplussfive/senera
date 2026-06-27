export type AskUserToolArguments = {
  // 必须。要展示给用户的澄清问题；应具体、简短。
  question: string

  // 可选。机器可读原因码，例如 missing_location、missing_scope。
  reason_code?: string
}
