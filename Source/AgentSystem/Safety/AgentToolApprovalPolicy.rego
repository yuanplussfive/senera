package senera.tool

import rego.v1

default decision := {
  "decision": "not-applicable",
  "reason": "没有匹配的工具审批策略。",
  "rule": "default.not_applicable",
  "riskSignals": [],
}

decision := {
  "decision": "deny",
  "reason": approval_reason(data.senera.tool_approval.Reasons.ManifestDeny),
  "rule": "tool.manifest.deny",
  "riskSignals": risk_signals,
} if {
  input.tool.approval.Mode == "deny"
} else := {
  "decision": "requires-approval",
  "reason": data.senera.tool_approval.Reasons.LocalExecution,
  "rule": "execution.target.local",
  "riskSignals": risk_signals,
} if {
  input.execution.target == "Local"
  "Sandbox" in input.execution.availableTargets
} else := {
  "decision": "requires-approval",
  "reason": data.senera.tool_approval.Reasons.MissingTool,
  "rule": "tool.registry.missing",
  "riskSignals": risk_signals,
} if {
  not input.tool.registered
} else := {
  "decision": "requires-approval",
  "reason": approval_reason(data.senera.tool_approval.Reasons.ManifestAsk),
  "rule": "tool.manifest.ask",
  "riskSignals": risk_signals,
} if {
  input.tool.approval.Mode == "ask"
} else := {
  "decision": "requires-approval",
  "reason": data.senera.tool_approval.Reasons.RequiresApproval,
  "rule": "plugin.security.requires_approval",
  "riskSignals": risk_signals,
} if {
  input.tool.security.RequiresApproval == true
} else := {
  "decision": "requires-approval",
  "reason": data.senera.tool_approval.Reasons.Untrusted,
  "rule": "plugin.security.untrusted",
  "riskSignals": risk_signals,
} if {
  input.tool.security.TrustLevel == "Untrusted"
} else := {
  "decision": "requires-approval",
  "reason": data.senera.tool_approval.Reasons.RiskPermission,
  "rule": "risk.permission.high_impact",
  "riskSignals": risk_signals,
} if {
  some permission in risk_permissions
  permission in data.senera.tool_approval.HighImpact.RiskPermissions
} else := {
  "decision": "requires-approval",
  "reason": data.senera.tool_approval.Reasons.RiskSideEffect,
  "rule": "risk.side_effect.persistent_or_process",
  "riskSignals": risk_signals,
} if {
  some side_effect in risk_side_effects
  side_effect in data.senera.tool_approval.HighImpact.RiskSideEffects
} else := {
  "decision": "requires-approval",
  "reason": data.senera.tool_approval.Reasons.ToolPermission,
  "rule": "tool.permission.high_impact",
  "riskSignals": risk_signals,
} if {
  some permission in input.tool.permissions
  some term in data.senera.tool_approval.HighImpact.ToolPermissionTerms
  contains(permission, term)
} else := {
  "decision": "allow",
  "reason": approval_reason(data.senera.tool_approval.Reasons.ManifestAllow),
  "rule": "tool.manifest.allow",
  "riskSignals": risk_signals,
} if {
  input.tool.approval.Mode == "allow"
} else := {
  "decision": "allow",
  "reason": data.senera.tool_approval.Reasons.DefaultAllow,
  "rule": "risk.default.allow",
  "riskSignals": risk_signals,
} if {
  input.tool.registered
}

risk_permissions contains permission if {
  some risk in input.tool.capabilities.risks
  permission := risk.Permission
}

risk_side_effects contains side_effect if {
  some risk in input.tool.capabilities.risks
  side_effect := risk.SideEffect
}

risk_side_effects contains side_effect if {
  some side_effect in input.tool.capabilities.effects
}

risk_signals contains sprintf("tool.permission:%s", [permission]) if {
  some permission in input.tool.permissions
}

risk_signals contains sprintf("risk.permission:%s", [permission]) if {
  some permission in risk_permissions
}

risk_signals contains sprintf("risk.sideEffect:%s", [side_effect]) if {
  some side_effect in risk_side_effects
}

risk_signals contains sprintf("security.trustLevel:%s", [input.tool.security.TrustLevel]) if {
  input.tool.security.TrustLevel
}

risk_signals contains "security.requiresApproval:true" if {
  input.tool.security.RequiresApproval == true
}

approval_reason(default_reason) := reason if {
  reason := input.tool.approval.Reason
}

approval_reason(default_reason) := default_reason if {
  not input.tool.approval.Reason
}
