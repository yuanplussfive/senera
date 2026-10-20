import fs from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { once } from "node:events";
import { startSeneraServer, SeneraServerDeployments } from "../../Dist/Apps/ServerRuntime.js";
import { CurrentAgentConfigVersion } from "../../Dist/Source/AgentSystem/Config/AgentConfigVersion.js";

export async function createWorkspaceHostHarness() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "senera-workspace-browser-"));
  const a = path.join(root, "workspace-a"),
    b = path.join(root, "workspace-b");
  const applicationRoot = path.join(root, "application");
  let app;
  try {
    await Promise.all([fs.mkdir(a), fs.mkdir(b)]);
    await fs.mkdir(path.join(a, "src"));
    await Promise.all([
      fs.writeFile(path.join(a, "src", "example.txt"), "工作区 A 的文件\n"),
      fs.writeFile(path.join(a, "src", "example.ts"), 'export const message = "Hello Senera";\n'),
      fs.writeFile(
        path.join(a, "README.md"),
        "# Senera 工作区\n\n清晰的文件预览。\n\n- 文件树\n- 原生编辑\n\n| 功能 | 状态 |\n| --- | --- |\n| 预览 | 可用 |\n\n```ts\nexport const project = 'Senera';\n```\n",
      ),
      fs.writeFile(path.join(a, "data.json"), JSON.stringify({ project: "Senera", files: ["example.ts"] })),
      fs.writeFile(path.join(b, "example.txt"), "工作区 B 的文件\n"),
    ]);
    const probe = net.createServer();
    probe.listen(0, "127.0.0.1");
    await once(probe, "listening");
    const address = probe.address();
    if (!address || typeof address === "string") throw new Error("No browser test port.");
    await new Promise((resolve) => probe.close(resolve));
    await fs.writeFile(
      path.join(a, "senera.config.json"),
      JSON.stringify({
        ConfigVersion: CurrentAgentConfigVersion,
        Server: { Host: "127.0.0.1", Port: address.port, HotReload: false },
        ModelProviderEndpoints: [{ Id: "local-test", BaseUrl: "http://127.0.0.1:1/v1" }],
        ModelProviders: [{ Id: "test", ProviderId: "local-test", Endpoint: "ChatCompletions", Model: "test" }],
        DefaultModelProviderId: "test",
        ContinuityLearning: { Enabled: false },
        Extensions: { "workspace-tools": { Enabled: true } },
      }),
    );
    app = await startSeneraServer({
      workspaceRoot: a,
      applicationStateRoot: applicationRoot,
      configPath: path.join(a, "senera.config.json"),
      deployment: SeneraServerDeployments.Local,
      automaticLoopbackHttp: true,
      staticFrontendRoot: path.resolve("Frontend/dist"),
    });
    return {
      a,
      b,
      applicationRoot,
      httpOrigin: new URL(app.healthUrl).origin,
      stop: async () => {
        try {
          await app.stop();
        } finally {
          await fs.rm(root, { recursive: true, force: true });
        }
      },
    };
  } catch (error) {
    try {
      await app?.stop();
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
    throw error;
  }
}
