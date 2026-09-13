import { createHash, timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { executeAgentSelfInvocation } from "./AgentSelfCommand.js";
import { AgentSelfInvocationSchema } from "./AgentSelfCommandSchema.js";
import type { AgentSelfApprovalChannel } from "./AgentSelfApprovalTypes.js";
import { AgentSelfApprovalRegistry } from "./AgentSelfApprovalRegistry.js";
import { createHttpApprovalTransport } from "./AgentApprovalTransport.js";
import type { AgentSelfServicePort } from "./AgentSelfServiceTypes.js";

export const AgentSelfHttpRoute = "/senera/self" as const;

const MaxSelfCommandBytes = 512 * 1_024;

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
    const output = await executeAgentSelfInvocation(parsed.data, this.port, {
      approvals: this.approvals,
    });
    this.write(response, 200, output);
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

  private write(response: ServerResponse, status: number, payload: unknown): void {
    response.writeHead(status, {
      "Cache-Control": "no-store",
      "Content-Type": "application/json; charset=utf-8",
    });
    response.end(JSON.stringify(payload));
  }
}

function readBearerToken(request: IncomingMessage): string | undefined {
  const authorization = request.headers.authorization;
  if (!authorization) return undefined;
  const match = /^Bearer\s+(.+)$/i.exec(authorization.trim());
  return match?.[1];
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
