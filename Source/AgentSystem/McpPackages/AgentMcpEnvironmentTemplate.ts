import { AgentBaseError } from "../Core/AgentBaseError.js";

export interface AgentMcpEnvironmentReference {
  readonly name: string;
  readonly defaultValue?: string;
}

export type AgentMcpEnvironmentTemplateSegment =
  | { readonly kind: "literal"; readonly value: string }
  | ({ readonly kind: "reference" } & AgentMcpEnvironmentReference);

export interface AgentMcpCredentialValue {
  readonly value: string;
  readonly source: "vault" | "environment" | "oauth";
}

export interface AgentMcpCredentialResolver {
  resolve(serverId: string, name: string): AgentMcpCredentialValue | undefined;
}

export class AgentMcpEnvironmentTemplateError extends AgentBaseError {
  constructor(
    message: string,
    readonly offset: number,
  ) {
    super(message);
  }
}

export class AgentMcpCredentialsRequiredError extends AgentBaseError {
  readonly code = "mcp_credentials_required";

  constructor(
    readonly serverId: string,
    readonly names: readonly string[],
  ) {
    super(`MCP server ${serverId} requires credentials: ${names.join(", ")}.`);
  }
}

export function parseAgentMcpEnvironmentTemplate(source: string): readonly AgentMcpEnvironmentTemplateSegment[] {
  const segments: AgentMcpEnvironmentTemplateSegment[] = [];
  let cursor = 0;
  while (cursor < source.length) {
    const opening = source.indexOf("${", cursor);
    if (opening < 0) {
      appendLiteral(segments, source.slice(cursor));
      break;
    }
    appendLiteral(segments, source.slice(cursor, opening));
    const closing = source.indexOf("}", opening + 2);
    if (closing < 0)
      throw new AgentMcpEnvironmentTemplateError("Environment reference is missing its closing brace.", opening);
    segments.push(parseReference(source.slice(opening + 2, closing), opening));
    cursor = closing + 1;
  }
  return segments;
}

export function listAgentMcpEnvironmentReferences(
  values: Readonly<Record<string, string>> | undefined,
): readonly AgentMcpEnvironmentReference[] {
  const references = Object.values(values ?? {}).flatMap((value) =>
    parseAgentMcpEnvironmentTemplate(value).flatMap((segment) =>
      segment.kind === "reference" ? [{ name: segment.name, defaultValue: segment.defaultValue }] : [],
    ),
  );
  const merged = new Map<string, AgentMcpEnvironmentReference>();
  for (const reference of references) {
    const current = merged.get(reference.name);
    merged.set(reference.name, {
      name: reference.name,
      ...(!current || (current.defaultValue !== undefined && reference.defaultValue !== undefined)
        ? { defaultValue: reference.defaultValue }
        : {}),
    });
  }
  return [...merged.values()];
}

export function resolveAgentMcpEnvironmentRecord(
  serverId: string,
  values: Readonly<Record<string, string>> | undefined,
  credentials: AgentMcpCredentialResolver,
): Record<string, string> {
  const missing = new Set<string>();
  const resolved = Object.fromEntries(
    Object.entries(values ?? {}).map(([name, template]) => [
      name,
      resolveTemplate(serverId, parseAgentMcpEnvironmentTemplate(template), credentials, missing),
    ]),
  );
  if (missing.size > 0) throw new AgentMcpCredentialsRequiredError(serverId, [...missing].sort());
  return resolved;
}

export function validateAgentMcpEnvironmentTemplate(source: string): string | undefined {
  try {
    parseAgentMcpEnvironmentTemplate(source);
    return undefined;
  } catch (error) {
    return error instanceof AgentMcpEnvironmentTemplateError ? error.message : String(error);
  }
}

function parseReference(source: string, offset: number): AgentMcpEnvironmentTemplateSegment {
  const defaultSeparator = source.indexOf(":-");
  const name = defaultSeparator < 0 ? source : source.slice(0, defaultSeparator);
  if (!isEnvironmentName(name)) {
    throw new AgentMcpEnvironmentTemplateError(`Environment reference name is invalid: ${name || "<empty>"}.`, offset);
  }
  return {
    kind: "reference",
    name,
    ...(defaultSeparator < 0 ? {} : { defaultValue: source.slice(defaultSeparator + 2) }),
  };
}

function resolveTemplate(
  serverId: string,
  segments: readonly AgentMcpEnvironmentTemplateSegment[],
  credentials: AgentMcpCredentialResolver,
  missing: Set<string>,
): string {
  return segments
    .map((segment) => {
      if (segment.kind === "literal") return segment.value;
      const credential = credentials.resolve(serverId, segment.name);
      if (credential) return credential.value;
      if (segment.defaultValue !== undefined) return segment.defaultValue;
      missing.add(segment.name);
      return "";
    })
    .join("");
}

function appendLiteral(segments: AgentMcpEnvironmentTemplateSegment[], value: string): void {
  if (value) segments.push({ kind: "literal", value });
}

function isEnvironmentName(value: string): boolean {
  if (!value || !isEnvironmentNameStart(value.charCodeAt(0))) return false;
  for (let index = 1; index < value.length; index += 1) {
    if (!isEnvironmentNameContinuation(value.charCodeAt(index))) return false;
  }
  return true;
}

function isEnvironmentNameStart(code: number): boolean {
  return code === 95 || isAsciiLetter(code);
}

function isEnvironmentNameContinuation(code: number): boolean {
  return isEnvironmentNameStart(code) || (code >= 48 && code <= 57);
}

function isAsciiLetter(code: number): boolean {
  return (code >= 65 && code <= 90) || (code >= 97 && code <= 122);
}
