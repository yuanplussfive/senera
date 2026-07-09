import type http from "node:http";
import type { AgentStaticFrontendHttpApi } from "./AgentStaticFrontendHttpApi.js";
import { AgentUploadHttpApi } from "../Uploads/AgentUploadHttpApi.js";
import type { AgentPiProxyHttpApi } from "../PiProxy/AgentPiProxyHttpApi.js";

export class AgentWebSocketHttpRouter {
  constructor(
    private readonly options: {
      uploadApi: AgentUploadHttpApi;
      piProxyApi?: AgentPiProxyHttpApi;
      staticFrontendApi?: AgentStaticFrontendHttpApi;
    },
  ) {}

  async handle(
    request: http.IncomingMessage,
    response: http.ServerResponse,
  ): Promise<void> {
    if (this.options.uploadApi.canHandle(request)) {
      await this.options.uploadApi.handle(request, response);
      return;
    }

    if (this.options.piProxyApi?.canHandle(request)) {
      await this.options.piProxyApi.handle(request, response);
      return;
    }

    if (this.options.staticFrontendApi?.canHandle(request)) {
      this.options.staticFrontendApi.handle(request, response);
      return;
    }

    response.writeHead(404, {
      "Content-Type": "application/json; charset=utf-8",
    });
    response.end(JSON.stringify({
      ok: false,
      error: {
        code: "not_found",
        message: "接口不存在。",
      },
    }));
  }
}
