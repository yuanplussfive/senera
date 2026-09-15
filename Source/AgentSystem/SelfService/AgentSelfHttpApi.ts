import { createHash, timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { executeAgentSelfInvocation } from "./AgentSelfCommand.js";
import { AgentSelfInvocationSchema } from "./AgentSelfCommandSchema.js";
import type { AgentSelfApprovalChannel } from "./AgentSelfApprovalTypes.js";
import { AgentSelfApprovalRegistry } from "./AgentSelfApprovalRegistry.js";
import { createHttpApprovalTransport } from "./AgentApprovalTransport.js";
import type { AgentSelfCommandOutput, AgentSelfServicePort } from "./AgentSelfServiceTypes.js";

export const AgentSelfHttpRoute = "/senera/self" as const;

const MaxSelfCommandBytes = 512 * 1_024;
const DiagnosticFieldNames = new Set(["stack", "stacktrace"]);

export type AgentSelfHttpJsonValue =
  | null
  | boolean
  | number
  | string
  | readonly AgentSelfHttpJsonValue[]
  | { readonly [key: string]: AgentSelfHttpJsonValue };

export type AgentSelfHttpPayload =
  | AgentSelfCommandOutput
  | {
      readonly ok: false;
      readonly error: { readonly code: string; readonly message: string };
      readonly text?: string;
      readonly data?: unknown;
    };

export interface AgentSelfHttpPublicPayload {
  readonly ok: boolean;
  readonly text?: string;
  readonly data?: AgentSelfHttpJsonValue;
  readonly error?: string | { readonly code: string; readonly message: string };
  readonly approvalRequired?: {
    readonly approvalId: string;
    readonly command: AgentSelfHttpJsonValue;
    readonly reason: string;
    readonly deadlineAt: string;
  };
}

export class AgentSelfHttpApi {
  private token: string | undefined;
  private readonly approvals: AgentSelfApprovalChannel;
  private readonly registry = new AgentSelfApprovalRegistry();

  constructor(
    private readonly port: AgentSelfServicePort,
    options: { readonly approvals?: AgentSelfApprovalChannel } = {},
  ) {
    this.approvals = options.approvals ?? createHttpApprovalTransport(this.registry);
  }

  /** Binds the runtime access token generated at server start. */
  bindToken(token: string): void {
    this.token = token;
  }

  canHandle(request: IncomingMessage): boolean {
    return (
      request.method === "POST" && new URL(request.url ?? "/", "http://senera.local").pathname === AgentSelfHttpRoute
    );
  }

  async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    if (!this.authorized(request)) {
      this.write(response, 401, {
        ok: false,
        error: { code: "authentication_required", message: "Missing or invalid runtime access token." },
      });
      return;
    }
    const body = await this.readBody(request, response);
    if (body === undefined) return;
    let payload: unknown;
    try {
      payload = JSON.parse(body.toString("utf8"));
    } catch {
      this.write(response, 400, {
        ok: false,
        error: { code: "invalid_json", message: "Request body is not valid JSON." },
      });
      return;
    }
    const parsed = AgentSelfInvocationSchema.safeParse(payload);
    if (!parsed.success) {
      this.write(response, 400, {
        ok: false,
        error: { code: "invalid_command", message: zippedIssues(parsed.error) },
      });
      return;
    }
    try {
      const output = await executeAgentSelfInvocation(parsed.data, this.port, {
        approvals: this.approvals,
      });
      this.write(response, 200, output);
    } catch {
      this.write(response, 500, {
        ok: false,
        error: { code: "command_failed", message: "The self-service command could not be completed." },
      });
    }
  }

  private authorized(request: IncomingMessage): boolean {
    const token = this.token;
    if (!token) return false;
    const presented = readBearerToken(request);
    if (!presented) return false;
    return tokensEqual(presented, token);
  }

  private async readBody(request: IncomingMessage, response: ServerResponse): Promise<Buffer | undefined> {
    const declared = Number(request.headers["content-length"] ?? 0);
    if (declared > MaxSelfCommandBytes) {
      this.write(response, 413, {
        ok: false,
        error: { code: "payload_too_large", message: "Request body exceeds the size limit." },
      });
      return undefined;
    }
    return new Promise<Buffer | undefined>((resolve) => {
      const chunks: Buffer[] = [];
      let size = 0;
      let settled = false;
      const fail = (code: string, message: string, status: number): void => {
        if (settled) return;
        settled = true;
        request.removeAllListeners();
        this.write(response, status, { ok: false, error: { code, message } });
        resolve(undefined);
      };
      request.on("data", (chunk: Buffer) => {
        if (settled) return;
        size += chunk.length;
        if (size > MaxSelfCommandBytes) {
          request.destroy();
          fail("payload_too_large", "Request body exceeds the size limit.", 413);
          return;
        }
        chunks.push(chunk);
      });
      request.on("end", () => {
        if (settled) return;
        settled = true;
        resolve(Buffer.concat(chunks));
      });
      request.on("error", () => fail("request_failed", "Request stream failed.", 400));
    });
  }

  private write(response: ServerResponse, status: number, payload: AgentSelfHttpPayload): void {
    response.writeHead(status, {
      "Cache-Control": "no-store",
      "Content-Type": "application/json; charset=utf-8",
    });
    // codeql[js/stack-trace-exposure] The public projection rebuilds JSON data and omits diagnostic fields before serialization.
    response.end(JSON.stringify(projectAgentSelfHttpPayload(payload)));
  }
}

function readBearerToken(request: IncomingMessage): string | undefined {
  const authorization = request.headers.authorization;
  if (!authorization) return undefined;
  const normalized = authorization.trim();
  if (normalized.slice(0, 6).toLowerCase() !== "bearer") return undefined;
  if (normalized.slice(6, 7).trim() !== "") return undefined;
  const token = normalized.slice(7).trim();
  return token.length > 0 ? token : undefined;
}

export function projectAgentSelfHttpPayload(payload: AgentSelfHttpPayload): AgentSelfHttpPublicPayload {
  const source: Record<string, unknown> = isRecord(payload) ? payload : {};
  const result: {
    ok: boolean;
    text?: string;
    data?: AgentSelfHttpJsonValue;
    error?: string | { readonly code: string; readonly message: string };
    approvalRequired?: AgentSelfHttpPublicPayload["approvalRequired"];
  } = { ok: source.ok === true };

  if (typeof source.text === "string") result.text = source.text;
  if (typeof source.error === "string") {
    result.error = source.error;
  } else if (isRecord(source.error)) {
    const code = source.error.code;
    const message = source.error.message;
    if (typeof code === "string" && typeof message === "string") result.error = { code, message };
  }

  const data = projectAgentSelfHttpJsonValue(source.data);
  if (data !== undefined) result.data = data;

  const approvalRequired = projectApprovalRequired(source.approvalRequired);
  if (approvalRequired) result.approvalRequired = approvalRequired;
  return result;
}

export function projectAgentSelfHttpJsonValue(value: unknown): AgentSelfHttpJsonValue | undefined {
  return projectJsonValue(value, new Set<object>());
}

function projectApprovalRequired(value: unknown): AgentSelfHttpPublicPayload["approvalRequired"] {
  if (!isRecord(value)) return undefined;
  const approvalId = value.approvalId;
  const reason = value.reason;
  const deadlineAt = value.deadlineAt;
  if (typeof approvalId !== "string" || typeof reason !== "string" || typeof deadlineAt !== "string") return undefined;
  const command = projectAgentSelfHttpJsonValue(value.command);
  if (command === undefined) return undefined;
  return { approvalId, command, reason, deadlineAt };
}

function projectJsonValue(value: unknown, ancestors: Set<object>): AgentSelfHttpJsonValue | undefined {
  if (value === null) return null;
  if (typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "object") return undefined;
  if (ancestors.has(value)) return undefined;

  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      return value.map((entry) => projectJsonValue(entry, ancestors) ?? null);
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return undefined;

    const output: Record<string, AgentSelfHttpJsonValue> = {};
    for (const key of Object.keys(value)) {
      if (DiagnosticFieldNames.has(key.toLowerCase())) continue;
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !("value" in descriptor)) continue;
      const projected = projectJsonValue(descriptor.value, ancestors);
      if (projected !== undefined) output[key] = projected;
    }
    return output;
  } catch {
    return undefined;
  } finally {
    ancestors.delete(value);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function tokensEqual(presented: string, expected: string): boolean {
  const a = createHash("sha256").update(presented).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

function zippedIssues(error: {
  issues: readonly { readonly path: readonly (string | number | symbol)[]; readonly message: string }[];
}): string {
  return error.issues
    .map((issue) => `${issue.path.length > 0 ? issue.path.join(".") : "(root)"}: ${issue.message}`)
    .join("; ");
}
