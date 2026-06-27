export type MemoryWriteOperation =
  | "create"
  | "reinforce"
  | "update"
  | "supersede"

export type MemoryWriteType =
  | "profile"
  | "preference"
  | "knowledge"
  | "scene"

export type MemoryWriteToolArguments = {
  // 默认 create；reinforce/update/supersede 需要 targetMemoryUri。
  operation?: MemoryWriteOperation

  // 长期记忆类型。
  type: MemoryWriteType

  // 记忆主体，例如 assistant_work_style、用户饮料偏好。
  subject: string

  // 需要长期记住的具体陈述。
  claim: string

  // 以后如何使用这条记忆。
  howToApply: string

  // 简短分类标签。
  tags: {
    item: string[]
  }

  // 未来哪些自然表达应召回这条记忆。
  triggers: {
    item: string[]
  }

  // 模型对这条显式记忆的置信度，0 到 1。
  confidence: number

  // update/supersede 目标记忆 URI。
  targetMemoryUri?: string

  // 可选写入原因。
  reason?: string
}

export type MemoryWriteToolResult = {
  status: "written" | "skipped"
  memories: {
    item: Array<{
      memoryUri: string
      operation: MemoryWriteOperation
      type: MemoryWriteType
      subject: string
      claim: string
      howToApply: string
      tags: {
        item: string[]
      }
      triggers: {
        item: string[]
      }
      sourceRefs: {
        item: string[]
      }
      status: string
      confidence: number
      targetMemoryUri: string
      updatedAt: string
      localDate: string
    }>
  }
  warnings: {
    item: string[]
  }
  guidance: string
}
