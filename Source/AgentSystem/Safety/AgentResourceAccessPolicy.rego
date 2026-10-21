package senera.resource

import rego.v1

default decision := {
  "decision": "deny",
  "reason": "资源访问没有匹配允许策略。",
  "rule": "resource.default_deny",
  "riskSignals": [],
}

decision := {
  "decision": "deny",
  "reason": data.senera.tool_approval.Reasons.ResourceOutsideScope,
  "rule": "resource.scope.denied",
  "riskSignals": resource_risk_signals,
} if {
  not input.resource.scope in data.senera.tool_approval.ResourceAccess.AllowedScopes
} else := {
  "decision": "deny",
  "reason": data.senera.tool_approval.Reasons.ResourceUnresolved,
  "rule": "resource.containment.denied",
  "riskSignals": resource_risk_signals,
} if {
  input.resource.containment in data.senera.tool_approval.ResourceAccess.DeniedContainments
} else := {
  "decision": "deny",
  "reason": data.senera.tool_approval.Reasons.ResourceLinkEscape,
  "rule": "resource.link_escape",
  "riskSignals": resource_risk_signals,
} if {
  input.resource.linkTraversal in data.senera.tool_approval.ResourceAccess.DeniedLinkTraversals
} else := {
  "decision": "deny",
  "reason": data.senera.tool_approval.Reasons.ResourceProtectedMutation,
  "rule": "resource.protected.mutation",
  "riskSignals": resource_risk_signals,
} if {
  input.resource.intent in data.senera.tool_approval.ResourceAccess.MutationIntents
  input.resource.domain in data.senera.tool_approval.ResourceAccess.ProtectedMutationDomains
} else := {
  "decision": "deny",
  "reason": data.senera.tool_approval.Reasons.ResourceManagedExtensionRootMutation,
  "rule": "resource.managed_extension.root_mutation",
  "riskSignals": resource_risk_signals,
} if {
  input.resource.intent in data.senera.tool_approval.ResourceAccess.MutationIntents
  input.resource.domain in data.senera.tool_approval.ResourceAccess.ManagedExtensionDomains
  input.resource.domainRoot
} else := {
  "decision": "deny",
  "reason": data.senera.tool_approval.Reasons.ResourceManagedExtensionMutation,
  "rule": "resource.managed_extension.unvalidated_mutation",
  "riskSignals": resource_risk_signals,
} if {
  input.resource.intent in data.senera.tool_approval.ResourceAccess.MutationIntents
  input.resource.domain in data.senera.tool_approval.ResourceAccess.ManagedExtensionDomains
  not input.resource.authority in data.senera.tool_approval.ResourceAccess.ManagedExtensionPublisherAuthorities
} else := {
  "decision": "deny",
  "reason": data.senera.tool_approval.Reasons.ResourceFinalLinkMutation,
  "rule": "resource.final_link.mutation",
  "riskSignals": resource_risk_signals,
} if {
  input.resource.intent in data.senera.tool_approval.ResourceAccess.MutationIntents
  input.resource.finalEntry == "link"
} else := {
  "decision": "allow",
  "reason": data.senera.tool_approval.Reasons.ResourceAllowed,
  "rule": "resource.allowed",
  "riskSignals": resource_risk_signals,
} if {
  input.resource.containment == "inside"
}

resource_risk_signals contains sprintf("resource.scope:%s", [input.resource.scope]) if {
  input.resource.scope
}

resource_risk_signals contains sprintf("resource.intent:%s", [input.resource.intent]) if {
  input.resource.intent
}

resource_risk_signals contains sprintf("resource.domain:%s", [input.resource.domain]) if {
  input.resource.domain
}

resource_risk_signals contains sprintf("resource.authority:%s", [input.resource.authority]) if {
  input.resource.authority
}

resource_risk_signals contains sprintf("resource.containment:%s", [input.resource.containment]) if {
  input.resource.containment
}

resource_risk_signals contains sprintf("resource.linkTraversal:%s", [input.resource.linkTraversal]) if {
  input.resource.linkTraversal
}
