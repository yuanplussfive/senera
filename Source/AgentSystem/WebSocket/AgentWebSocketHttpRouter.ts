import type http from "node:http";
import { AgentUploadHttpApi } from "../Uploads/AgentUploadHttpApi.js";

export class AgentWebSocketHttpRouter {
  constructor(
    private readonly options: {
      uploadApi: AgentUploadHttpApi;
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
