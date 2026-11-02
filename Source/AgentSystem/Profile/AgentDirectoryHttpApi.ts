import type { IncomingMessage, ServerResponse } from "node:http";
import { ZodError } from "zod";
import { applyCredentialedCors, writeCorsPreflight } from "../Auth/AgentCredentialedCors.js";
import {
  AgentDirectoryCommandSchema,
  AgentDirectoryHttpPath,
  type WorkspaceAgentInput,
} from "../Core/AgentDirectoryContract.js";
import { readStreamJsonBody } from "../Core/AgentJsonParsing.js";
import { AgentDirectory, AgentDirectoryConflictError } from "./AgentDirectory.js";

export class AgentDirectoryHttpApi {
  constructor(
    private readonly options: {
      directory: AgentDirectory;
      commands?: import("./AgentDirectoryLifecycle.js").AgentDirectoryLifecycle;
      maximumBytes: number;
      validateAgent: (input: WorkspaceAgentInput) => Promise<void>;
      isOriginAllowed: (origin: string, request: IncomingMessage) => boolean;
    },
  ) {}

  canHandle(request: IncomingMessage): boolean {
    return new URL(request.url ?? "/", "http://senera.local").pathname === AgentDirectoryHttpPath;
  }

  async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    if (
      !applyCredentialedCors(request, response, {
        allowedMethods: ["GET", "POST", "OPTIONS"],
        allowedHeaders: ["Content-Type", "X-Senera-Csrf"],
        isOriginAllowed: this.options.isOriginAllowed,
      })
    ) {
      this.send(response, 403, { message: "The request origin is not allowed." });
      return;
    }
    if (request.method === "OPTIONS") {
      writeCorsPreflight(response);
      return;
    }
    if (request.method === "GET") {
      this.send(response, 200, this.options.directory.snapshot());
      return;
    }
    if (request.method !== "POST") {
      response.setHeader("Allow", "GET, POST, OPTIONS");
      this.send(response, 405, { message: "Use GET or POST." });
      return;
    }
    try {
      const command = AgentDirectoryCommandSchema.parse(
        await readStreamJsonBody(request, {
          maximumBytes: this.options.maximumBytes,
          contextLabel: "Agent settings",
        }),
      );
      if ("agent" in command) await this.options.validateAgent(command.agent);
      if (command.type === "agent.delete" && !this.options.commands)
        throw new Error("Agent deletion is not connected to host cleanup.");
      this.send(
        response,
        200,
        this.options.commands ? await this.options.commands.execute(command) : this.options.directory.execute(command),
      );
    } catch (error) {
      this.send(response, error instanceof AgentDirectoryConflictError ? 409 : 400, {
        message:
          error instanceof ZodError
            ? error.issues.map((issue) => issue.message).join(" ")
            : error instanceof Error
              ? error.message
              : String(error),
      });
    }
  }

  private send(response: ServerResponse, status: number, body: unknown): void {
    response.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
    response.end(JSON.stringify(body));
  }
}
