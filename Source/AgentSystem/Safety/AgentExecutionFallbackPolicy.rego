package senera.execution

import rego.v1

fallback := {
  "decision": "deny",
  "reason": data.senera.tool_approval.Reasons.FallbackStrictSandbox,
  "rule": "execution.fallback.strict_sandbox",
  "riskSignals": fallback_risk_signals,
} if {
  input.execution.boundary == "Sandbox"
} else := {
  "decision": "deny",
  "reason": data.senera.tool_approval.Reasons.FallbackNotAllowed,
  "rule": "execution.fallback.not_allowed",
  "riskSignals": fallback_risk_signals,
} if {
  input.execution.boundary != "SandboxPreferred"
} else := {
  "decision": "deny",
  "reason": data.senera.tool_approval.Reasons.FallbackNotAllowed,
  "rule": "execution.fallback.not_allowed",
  "riskSignals": fallback_risk_signals,
} if {
  input.execution.localFallback != "Allow"
} else := {
  "decision": "deny",
  "reason": data.senera.tool_approval.Reasons.FallbackMissingTool,
  "rule": "execution.fallback.identity_unverified",
  "riskSignals": fallback_risk_signals,
} if {
  not input.tool.registered
} else := {
  "decision": "deny",
  "reason": data.senera.tool_approval.Reasons.FallbackUntrusted,
  "rule": "execution.fallback.untrusted",
  "riskSignals": fallback_risk_signals,
} if {
  input.tool.plugin.trustLevel in data.senera.tool_approval.Fallback.DenyTrustLevels
} else := {
  "decision": "requires-approval",
  "reason": data.senera.tool_approval.Reasons.FallbackExternalApproval,
  "rule": "execution.fallback.external_approval",
  "riskSignals": fallback_risk_signals,
} if {
  input.tool.plugin.rootKind == "User"
} else := {
  "decision": "requires-approval",
  "reason": data.senera.tool_approval.Reasons.FallbackExternalApproval,
  "rule": "execution.fallback.external_approval",
  "riskSignals": fallback_risk_signals,
} if {
  input.tool.plugin.trustLevel in data.senera.tool_approval.Fallback.ApprovalTrustLevels
} else := {
  "decision": "allow",
  "reason": data.senera.tool_approval.Reasons.FallbackSystemAllow,
  "rule": "execution.fallback.system_allow",
  "riskSignals": fallback_risk_signals,
} if {
  input.tool.plugin.trustLevel in data.senera.tool_approval.Fallback.AutoAllowTrustLevels
} else := {
  "decision": "deny",
  "reason": data.senera.tool_approval.Reasons.FallbackDefaultDeny,
  "rule": "execution.fallback.default_deny",
  "riskSignals": fallback_risk_signals,
} if {
  true
}

fallback_risk_signals contains sprintf("execution.from:%s", [input.execution.from]) if {
  input.execution.from
}

fallback_risk_signals contains sprintf("execution.to:%s", [input.execution.to]) if {
  input.execution.to
}

fallback_risk_signals contains sprintf("execution.network:%s", [input.execution.network]) if {
  input.execution.network
}

fallback_risk_signals contains sprintf("execution.workspace:%s", [input.execution.workspace]) if {
  input.execution.workspace
}

fallback_risk_signals contains sprintf("plugin.trustLevel:%s", [input.tool.plugin.trustLevel]) if {
  input.tool.plugin.trustLevel
}
