import http from "node:http";

const ViteClientEntry = 'src="/@vite/client"';
const RuntimeConfigEntry = 'src="/senera-runtime-config.js"';
const MainEntry = 'src="/src/main.tsx"';

export type DesktopLiveFrontendProbe =
  { kind: "ready" } | { kind: "unavailable"; message: string } | { kind: "invalid"; message: string };

export function probeDesktopLiveFrontend(url: string, timeoutMs = 2_000): Promise<DesktopLiveFrontendProbe> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (result: DesktopLiveFrontendProbe): void => {
      if (settled) return;
      settled = true;
      resolve(result);
    };

    let request: http.ClientRequest;
    try {
      request = http.get(url, (response) => {
        const statusCode = response.statusCode ?? 0;
        if (statusCode < 200 || statusCode >= 300) {
          response.resume();
          finish({
            kind: "invalid",
            message: `returned HTTP ${statusCode}`,
          });
          return;
        }

        const contentType = response.headers["content-type"] ?? "";
        if (!contentType.includes("text/html")) {
          response.resume();
          finish({
            kind: "invalid",
            message: `returned content type ${contentType || "<missing>"}`,
          });
          return;
        }

        const chunks: string[] = [];
        response.setEncoding("utf8");
        response.on("data", (chunk: string) => {
          chunks.push(chunk);
        });
        response.once("error", (error) => {
          finish({
            kind: "invalid",
            message: `failed while reading the response: ${error.message}`,
          });
        });
        response.once("end", () => {
          const body = chunks.join("");
          finish(
            isSeneraViteEntry(body)
              ? { kind: "ready" }
              : {
                  kind: "invalid",
                  message: "did not serve the Senera Vite entry page",
                },
          );
        });
      });
    } catch (error) {
      finish({
        kind: "unavailable",
        message: error instanceof Error ? error.message : String(error),
      });
      return;
    }

    request.once("error", (error) => {
      finish({
        kind: "unavailable",
        message: error.message,
      });
    });
    request.setTimeout(timeoutMs, () => {
      request.destroy();
      finish({
        kind: "unavailable",
        message: `timed out after ${timeoutMs}ms`,
      });
    });
  });
}

export function isSeneraViteEntry(html: string): boolean {
  return html.includes(ViteClientEntry) && html.includes(RuntimeConfigEntry) && html.includes(MainEntry);
}
