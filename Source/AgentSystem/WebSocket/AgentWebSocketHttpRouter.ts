import type http from "node:http";
import type { AgentStaticFrontendHttpApi } from "./AgentStaticFrontendHttpApi.js";
import { type AgentUploadHttpApi } from "../Uploads/AgentUploadHttpApi.js";
import { agentErrorMessage } from "../I18n/AgentMessageCatalog.js";
import { type AgentAuthenticationHttpApi } from "../Auth/AgentAuthenticationHttpApi.js";
import type { AgentAccessFailure, AgentServerAccessGuard } from "../Auth/AgentServerAccessGuard.js";
import type { AgentHealthHttpApi } from "./AgentHealthHttpApi.js";
import type { AgentWorkspaceResourceHttpApi } from "../WorkspaceResources/AgentWorkspaceResourceHttpApi.js";
import type { AgentProviderCredentialHttpApi } from "../Config/AgentProviderCredentialHttpApi.js";
import type { AgentRuntimeUpdateHttpApi } from "../Runtime/AgentRuntimeUpdateHttpApi.js";

export class AgentWebSocketHttpRouter {
  constructor(
    private readonly options: {
      uploadApi: AgentUploadHttpApi;
      providerCredentialApi?: AgentProviderCredentialHttpApi;
      workspaceResourceApi?: AgentWorkspaceResourceHttpApi;
      staticFrontendApi?: AgentStaticFrontendHttpApi;
      authenticationApi?: AgentAuthenticationHttpApi;
      healthApi?: AgentHealthHttpApi;
      runtimeUpdateApi?: AgentRuntimeUpdateHttpApi;
      accessGuard?: AgentServerAccessGuard;
    },
  ) {}

  async handle(request: http.IncomingMessage, response: http.ServerResponse): Promise<void> {
    if (this.options.authenticationApi?.canHandle(request)) {
      await this.options.authenticationApi.handle(request, response);
      return;
    }

    if (this.options.healthApi?.canHandle(request)) {
      this.options.healthApi.handle(request, response);
      return;
    }

    if (this.options.runtimeUpdateApi?.canHandle(request)) {
      if (request.method !== "OPTIONS" && !this.authorize(request, response)) {
        return;
      }
      await this.options.runtimeUpdateApi.handle(request, response);
      return;
    }

    if (this.options.providerCredentialApi?.canHandle(request)) {
      if (request.method !== "OPTIONS" && !this.authorize(request, response)) {
        return;
      }
      this.options.providerCredentialApi.handle(request, response);
      return;
    }

    if (this.options.workspaceResourceApi?.canHandle(request)) {
      if (request.method !== "OPTIONS" && !this.authorize(request, response)) {
        return;
      }
      await this.options.workspaceResourceApi.handle(request, response);
      return;
    }

    if (this.options.uploadApi.canHandle(request)) {
      if (request.method !== "OPTIONS" && !this.authorize(request, response)) {
        return;
      }
      await this.options.uploadApi.handle(request, response);
      return;
    }

    if (this.options.staticFrontendApi?.canHandle(request)) {
      this.options.staticFrontendApi.handle(request, response);
      return;
    }

    response.writeHead(404, {
      "Content-Type": "application/json; charset=utf-8",
    });
    response.end(
      JSON.stringify({
        ok: false,
        error: {
          code: "not_found",
          message: agentErrorMessage("websocket.httpRouteNotFound"),
        },
      }),
    );
  }

  private authorize(request: http.IncomingMessage, response: http.ServerResponse): boolean {
    if (!this.options.accessGuard) {
      return true;
    }
    const result = this.options.accessGuard.authorizeHttp(request, {
      requireCsrf: !["GET", "HEAD", "OPTIONS"].includes(request.method ?? ""),
    });
    if (result.ok) {
      return true;
    }
    this.writeAccessFailure(response, result.failure);
    return false;
  }

  private writeAccessFailure(response: http.ServerResponse, failure: AgentAccessFailure): void {
    if (failure.retryAfterSeconds) {
      response.setHeader("Retry-After", String(failure.retryAfterSeconds));
    }
    response.writeHead(failure.status, {
      "Cache-Control": "no-store",
      "Content-Type": "application/json; charset=utf-8",
    });
    response.end(
      JSON.stringify({
        ok: false,
        error: {
          code: failure.code,
          message: agentErrorMessage("auth.requestDenied"),
        },
      }),
    );
  }
}
