import crypto from "node:crypto";

const EvidenceUriProtocol = "senera:";
const EvidenceUriAuthority = "evidence";
const EvidenceIdPattern = /^ev_[a-f0-9]{24}$/;

export interface AgentEvidenceUriInput {
  artifactId: string;
  evidenceKey: string;
}

export function createAgentEvidenceUri(input: AgentEvidenceUriInput): string {
  return new URL(createAgentEvidenceId(input), `${EvidenceUriProtocol}//${EvidenceUriAuthority}/`).toString();
}

export function createAgentEvidenceId(input: AgentEvidenceUriInput): string {
  const digest = crypto
    .createHash("sha256")
    .update(`${input.artifactId}:${input.evidenceKey}`)
    .digest("hex")
    .slice(0, 24);
  return `ev_${digest}`;
}

export function parseAgentEvidenceUri(value: string): string | undefined {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return undefined;
  }

  if (url.protocol !== EvidenceUriProtocol || url.hostname !== EvidenceUriAuthority) {
    return undefined;
  }

  const id = url.pathname.replace(/^\/+/, "");
  return EvidenceIdPattern.test(id) ? id : undefined;
}

export function normalizeAgentEvidenceUri(value: string): string | undefined {
  const evidenceId = parseAgentEvidenceUri(value);
  return evidenceId ? new URL(evidenceId, `${EvidenceUriProtocol}//${EvidenceUriAuthority}/`).toString() : undefined;
}
