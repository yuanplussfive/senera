export type TaskPrioritizerToolArguments = {
  // 排序策略；默认 balanced。
  strategy?: "balanced" | "urgent_first" | "impact_first"

  // 聚焦偏好；默认 minimize_switching。
  focusMode?: "minimize_switching" | "quick_wins" | "deep_work"

  // 任务数组，至少 1 项。
  tasks: {
    item: Array<{
      title: string
      impact: number
      urgency: number
      effort: number
      blocked?: boolean
      owner?: string
      dependencies?: {
        item: string[]
      }
      labels?: {
        item: string[]
      }
    }>
  }
}
