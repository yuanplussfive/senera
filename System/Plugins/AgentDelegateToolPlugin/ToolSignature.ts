export type AgentDelegateToolArguments = {
  // Registered workflow name from active skills, for example "ParallelPullRequestReview".
  workflow: string

  // Optional current objective to attach to each planned child-agent job.
  objective?: string

  // "plan" only expands the workflow; "run" starts child agent loops and merge.
  executionMode?: "plan" | "run"

  // Optional evidence refs already visible in the current turn.
  evidenceUris?: {
    item: string[]
  }

  // Optional artifact URIs already visible in the current turn.
  artifactUris?: {
    item: string[]
  }
}

export type AgentDelegateToolResult = {
  workflow: {
    name: string
    title?: string
    description?: string
    pluginName: string
  }

  objective?: string

  execution: {
    mode: "plan" | "agentLoop"
    status: "readyForRuntime" | "completed"
  }

  schedule: {
    strategy: "sequential" | "parallel"
    maxConcurrency?: number
  }

  jobs: {
    item: Array<{
      jobId: string
      index: number
      status: "planned"
      workflowName: string
      agentName: string
      agentTitle?: string
      agentPluginName: string
      agentDescriptionFile: string
      agentInstructionsFile: string
      taskFile: string
      contextPack: string
      contextPackDescription?: string
      contextTemplateFile: string
      contextInputs: {
        item: string[]
      }
      toolScope: string
      historyPolicy: string
      artifactPolicy: string
      evidencePolicy?: string
      recommendedTools: {
        item: string[]
      }
      runtimeProfile: string
      outputSchema: string
      required: boolean
      suppliedEvidenceUris: {
        item: string[]
      }
      suppliedArtifactUris: {
        item: string[]
      }
    }>
  }

  jobCount: number

  mergePolicy: {
    name: string
    description?: string
    strategy: string
    templateFile: string
    outputSchema?: string
  }

  run?: {
    workflowName: string
    status: "completed"
    mode:
      | "sequentialDirectModelWithMerge"
      | "sequentialAgentLoopWithMerge"
      | "sequentialMixedWithMerge"
      | "parallelDirectModelWithMerge"
      | "parallelAgentLoopWithMerge"
      | "parallelMixedWithMerge"
    delegation: unknown
    merge: unknown
  }
}
