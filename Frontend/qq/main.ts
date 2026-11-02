import "../src/platform/browserCompatibility";

// Both server-hosted and APK-hosted documents initialize the same workspace context.
async function start(): Promise<void> {
  await import("./bootstrap");
  const { qqAuthentication, startQqAuthentication } = await import("./authentication");
  startQqAuthentication();
  const { waitForServerAuthorization } = await import("../src/api/waitForServerAuthorization");
  await waitForServerAuthorization(qqAuthentication);
  await import("./client/src/renderer/src/main");
}

void start().catch((error: unknown) => {
  console.error("QQ entry failed", error);
  const root = document.getElementById("app");
  if (root) {
    root.setAttribute("role", "alert");
    root.textContent = `无法启动聊天界面：${error instanceof Error ? error.message : String(error)}`;
    const path = document.querySelector<HTMLMetaElement>('meta[name="senera-console-path"]')?.content;
    if (path) {
      const link = document.createElement("a");
      link.href = new URL(path, window.location.origin).href;
      link.textContent = "返回主控台";
      root.append(document.createElement("br"), link);
    }
  }
});
