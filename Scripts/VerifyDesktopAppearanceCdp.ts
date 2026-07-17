import assert from "node:assert/strict";
import http from "node:http";
import WebSocket from "ws";

interface DebugTarget {
  type: string;
  title: string;
  url: string;
  webSocketDebuggerUrl: string;
}

interface CdpResponse {
  id?: number;
  result?: unknown;
  error?: {
    message: string;
    data?: string;
  };
}

const endpoint = process.env.SENERA_DESKTOP_CDP_ENDPOINT ?? "http://127.0.0.1:9333";

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});

async function main(): Promise<void> {
  let originalAppearancePreference: string | null | undefined;
  const mainTarget = await waitForTarget((target) => target.type === "page" && isMainWindowTarget(target.url));

  const mainClient = await createCdpClient(mainTarget.webSocketDebuggerUrl);
  try {
    await waitForDocumentReady(mainClient);
    originalAppearancePreference = await mainClient.evaluate(() => localStorage.getItem("senera.appearancePreference"));
    await mainClient.evaluate(() => {
      localStorage.removeItem("senera.appearancePreference");
      window.dispatchEvent(new StorageEvent("storage", { key: "senera.appearancePreference" }));
      return true;
    });
    await waitForDefaultAppearance(mainClient);

    const mainState = await mainClient.evaluate(() => ({
      title: document.title,
      text: document.body.innerText,
      dataset: { ...document.documentElement.dataset },
      hasDesktopBridge: Boolean(window.seneraDesktop),
    }));

    assert.equal(mainState.title, "senera");
    assert.equal(mainState.dataset.colorScheme, "classic");
    assert.equal(mainState.dataset.accentColor, "sky");
    assert.equal(mainState.dataset.themePreference, "system");
    assert.equal(mainState.hasDesktopBridge, true);
    assert.match(mainState.text, /senera|配置|技能|预设/);

    await mainClient.evaluate(async () => {
      await window.seneraDesktop?.openSettings({ section: "appearance" });
      return true;
    });
  } finally {
    mainClient.close();
  }

  const settingsTarget = await waitForTarget(
    (target) => target.type === "page" && target.url.includes("surface=settings"),
  );

  const settingsClient = await createCdpClient(settingsTarget.webSocketDebuggerUrl);
  try {
    await settingsClient.evaluate(async () => {
      await new Promise<void>((resolve) => {
        if (document.readyState !== "loading") {
          resolve();
          return;
        }
        document.addEventListener("DOMContentLoaded", () => resolve(), { once: true });
      });
      await new Promise<void>((resolve, reject) => {
        const startedAt = Date.now();
        const tick = () => {
          if (document.body.innerText.includes("暖纸") && document.body.innerText.includes("青瓷")) {
            resolve();
            return;
          }
          if (Date.now() - startedAt > 10000) {
            reject(new Error("Timed out waiting for settings content."));
            return;
          }
          window.setTimeout(tick, 100);
        };
        tick();
      });
      return true;
    });
    const settingsState = await settingsClient.evaluate(() => ({
      title: document.title,
      url: location.href,
      text: document.body.innerText,
      dataset: { ...document.documentElement.dataset },
    }));

    assert.match(settingsState.url, /surface=settings/);
    assert.match(settingsState.url, /section=appearance/);
    assert.equal(settingsState.dataset.colorScheme, "classic");
    assert.equal(settingsState.dataset.accentColor, "sky");
    assert.match(settingsState.text, /设置/);
    assert.match(settingsState.text, /外观/);
    assert.match(settingsState.text, /主题/);
    for (const label of ["暖纸", "冷灰", "墨灰", "森绿", "樱粉", "雾蓝", "薰紫", "抹茶", "蜜杏", "青瓷"]) {
      assert.match(settingsState.text, new RegExp(label));
    }
    for (const label of ["陶土", "天蓝", "苔绿", "紫藤", "蔷薇", "杏子", "青玉"]) {
      assert.match(settingsState.text, new RegExp(label));
    }

    await clickAppearanceRadio(settingsClient, "蜜杏");
    await waitForAppearanceDataset(settingsClient, "colorScheme", "honey");
    assert.equal(
      await settingsClient.evaluate(() => document.documentElement.dataset.accentColor),
      "sky",
      "Changing a color scheme must not silently replace the independently selected accent color.",
    );
    await clickButtonByText(settingsClient, "使用推荐");
    await waitForAppearanceDataset(settingsClient, "accentColor", "apricot");

    await clickAppearanceRadio(settingsClient, "浅色");
    await waitForAppearanceDataset(settingsClient, "themePreference", "light");
    await clickAppearanceRadio(settingsClient, "暖纸");
    await waitForAppearanceDataset(settingsClient, "colorScheme", "senera");
    await clickAppearanceRadio(settingsClient, "陶土");
    await waitForAppearanceDataset(settingsClient, "accentColor", "terra");
    await waitForSeneraLightTokens(settingsClient);

    const updatedSettingsState = await settingsClient.evaluate(() => ({
      dataset: { ...document.documentElement.dataset },
      bg: getComputedStyle(document.documentElement).getPropertyValue("--theme-bg").trim(),
      terra500: getComputedStyle(document.documentElement).getPropertyValue("--color-terra-500").trim(),
      userBubbleBg: getComputedStyle(document.documentElement).getPropertyValue("--theme-chat-user-bg").trim(),
      userBubbleFg: getComputedStyle(document.documentElement).getPropertyValue("--theme-chat-user-fg").trim(),
      userBubbleHoverBg: getComputedStyle(document.documentElement)
        .getPropertyValue("--theme-chat-user-hover-bg")
        .trim(),
      userBubbleFontSize: getComputedStyle(document.documentElement)
        .getPropertyValue("--theme-chat-user-font-size")
        .trim(),
      userBubbleLineHeight: getComputedStyle(document.documentElement)
        .getPropertyValue("--theme-chat-user-line-height")
        .trim(),
      assistantFontSize: getComputedStyle(document.documentElement)
        .getPropertyValue("--theme-chat-assistant-font-size")
        .trim(),
      assistantLineHeight: getComputedStyle(document.documentElement)
        .getPropertyValue("--theme-chat-assistant-line-height")
        .trim(),
    }));
    assert.equal(updatedSettingsState.dataset.colorScheme, "senera");
    assert.equal(updatedSettingsState.dataset.themePreference, "light");
    assert.equal(updatedSettingsState.bg, "rgb(248 248 246)");
    assert.equal(updatedSettingsState.terra500, "180 93 64");
    assert.equal(updatedSettingsState.userBubbleBg, "rgb(239 238 235)");
    assert.equal(updatedSettingsState.userBubbleFg, "rgb(43 40 32)");
    assert.equal(updatedSettingsState.userBubbleHoverBg, "rgb(224 223 219 / 0.80)");
    assert.equal(updatedSettingsState.userBubbleFontSize, "14.5px");
    assert.equal(updatedSettingsState.userBubbleLineHeight, "1.55");
    assert.equal(updatedSettingsState.assistantFontSize, "15px");
    assert.equal(updatedSettingsState.assistantLineHeight, "1.75");

    await clickAppearanceRadio(settingsClient, "深色");
    await waitForAppearanceDataset(settingsClient, "themePreference", "dark");
    await waitForSeneraDarkTokens(settingsClient);

    const darkSettingsState = await settingsClient.evaluate(() => ({
      bg: getComputedStyle(document.documentElement).getPropertyValue("--theme-bg").trim(),
      terra500: getComputedStyle(document.documentElement).getPropertyValue("--color-terra-500").trim(),
      userBubbleBg: getComputedStyle(document.documentElement).getPropertyValue("--theme-chat-user-bg").trim(),
      userBubbleHoverBg: getComputedStyle(document.documentElement)
        .getPropertyValue("--theme-chat-user-hover-bg")
        .trim(),
    }));
    assert.equal(darkSettingsState.bg, "rgb(38 36 31)");
    assert.equal(darkSettingsState.terra500, "222 142 108");
    assert.equal(darkSettingsState.userBubbleBg, "rgb(55 51 43)");
    assert.equal(darkSettingsState.userBubbleHoverBg, "rgb(61 57 47)");

    await clickAppearanceRadio(settingsClient, "冷灰");
    await waitForAppearanceDataset(settingsClient, "colorScheme", "classic");
    await clickAppearanceRadio(settingsClient, "天蓝");
    await waitForAppearanceDataset(settingsClient, "accentColor", "sky");
    await waitForClassicDarkTokens(settingsClient);
  } finally {
    if (originalAppearancePreference == null) {
      await settingsClient.evaluate(() => {
        localStorage.removeItem("senera.appearancePreference");
        window.dispatchEvent(new StorageEvent("storage", { key: "senera.appearancePreference" }));
        return true;
      });
    } else {
      await settingsClient.evaluate((value: string) => {
        localStorage.setItem("senera.appearancePreference", value);
        window.dispatchEvent(new StorageEvent("storage", { key: "senera.appearancePreference" }));
        return true;
      }, originalAppearancePreference);
    }
    settingsClient.close();
  }

  console.log("Desktop appearance CDP verification passed.");
}

type CdpClient = Awaited<ReturnType<typeof createCdpClient>>;

async function waitForDocumentReady(client: CdpClient): Promise<void> {
  await client.evaluate(async () => {
    await new Promise<void>((resolve) => {
      if (document.readyState !== "loading") {
        resolve();
        return;
      }
      document.addEventListener("DOMContentLoaded", () => resolve(), { once: true });
    });
    return true;
  });
}

async function waitForDefaultAppearance(client: CdpClient): Promise<void> {
  await client.evaluate(async () => {
    await new Promise<void>((resolve, reject) => {
      const startedAt = Date.now();
      const tick = () => {
        if (
          document.documentElement.dataset.colorScheme === "classic" &&
          document.documentElement.dataset.accentColor === "sky" &&
          document.documentElement.dataset.themePreference === "system"
        ) {
          resolve();
          return;
        }
        if (Date.now() - startedAt > 5000) {
          reject(new Error("Timed out waiting for the default classic + sky appearance after storage reset."));
          return;
        }
        window.setTimeout(tick, 100);
      };
      tick();
    });
    return true;
  });
}

async function waitForSeneraLightTokens(client: CdpClient): Promise<void> {
  await client.evaluate(async () => {
    await new Promise<void>((resolve, reject) => {
      const startedAt = Date.now();
      const tick = () => {
        const style = getComputedStyle(document.documentElement);
        const hasSeneraLight =
          document.documentElement.dataset.colorScheme === "senera" &&
          document.documentElement.dataset.themePreference === "light" &&
          style.getPropertyValue("--theme-bg").trim() === "rgb(248 248 246)" &&
          style.getPropertyValue("--color-terra-500").trim() === "180 93 64" &&
          style.getPropertyValue("--theme-chat-user-bg").trim() === "rgb(239 238 235)";

        if (hasSeneraLight) {
          resolve();
          return;
        }
        if (Date.now() - startedAt > 5000) {
          reject(new Error("Timed out waiting for Senera light appearance tokens."));
          return;
        }
        window.setTimeout(tick, 100);
      };
      tick();
    });
    return true;
  });
}

async function waitForSeneraDarkTokens(client: CdpClient): Promise<void> {
  await client.evaluate(async () => {
    await new Promise<void>((resolve, reject) => {
      const startedAt = Date.now();
      const tick = () => {
        const style = getComputedStyle(document.documentElement);
        const hasSeneraDark =
          document.documentElement.dataset.colorScheme === "senera" &&
          document.documentElement.dataset.themePreference === "dark" &&
          style.getPropertyValue("--theme-bg").trim() === "rgb(38 36 31)" &&
          style.getPropertyValue("--color-terra-500").trim() === "222 142 108" &&
          style.getPropertyValue("--theme-chat-user-bg").trim() === "rgb(55 51 43)";

        if (hasSeneraDark) {
          resolve();
          return;
        }
        if (Date.now() - startedAt > 5000) {
          reject(new Error("Timed out waiting for Senera dark appearance tokens."));
          return;
        }
        window.setTimeout(tick, 100);
      };
      tick();
    });
    return true;
  });
}

async function waitForClassicDarkTokens(client: CdpClient): Promise<void> {
  await client.evaluate(async () => {
    await new Promise<void>((resolve, reject) => {
      const startedAt = Date.now();
      const tick = () => {
        const style = getComputedStyle(document.documentElement);
        const hasClassicDark =
          document.documentElement.dataset.colorScheme === "classic" &&
          document.documentElement.dataset.accentColor === "sky" &&
          document.documentElement.dataset.themePreference === "dark" &&
          style.getPropertyValue("--theme-bg").trim() === "rgb(17 24 39)" &&
          style.getPropertyValue("--color-terra-500").trim() === "96 165 250" &&
          style.getPropertyValue("--theme-chat-user-bg").trim() === "rgb(31 41 55)";

        if (hasClassicDark) {
          resolve();
          return;
        }
        if (Date.now() - startedAt > 5000) {
          reject(new Error("Timed out waiting for classic dark appearance tokens."));
          return;
        }
        window.setTimeout(tick, 100);
      };
      tick();
    });
    return true;
  });
}

async function clickAppearanceRadio(client: CdpClient, text: string): Promise<void> {
  await client.evaluate((label: string) => {
    const button = Array.from(document.querySelectorAll("button")).find((candidate) => {
      if (candidate.getAttribute("role") !== "radio") return false;
      const ariaLabel = candidate.getAttribute("aria-label")?.trim();
      return ariaLabel === `配色：${label}` || candidate.textContent?.trim() === label;
    });
    if (!(button instanceof HTMLButtonElement)) {
      throw new Error(`Could not find appearance radio button: ${label}`);
    }
    button.click();
    return true;
  }, text);
}

async function clickButtonByText(client: CdpClient, text: string): Promise<void> {
  await client.evaluate((label: string) => {
    const button = Array.from(document.querySelectorAll("button")).find(
      (candidate) => candidate.textContent?.trim() === label,
    );
    if (!(button instanceof HTMLButtonElement)) {
      throw new Error(`Could not find button: ${label}`);
    }
    button.click();
    return true;
  }, text);
}

async function waitForAppearanceDataset(client: CdpClient, key: string, value: string): Promise<void> {
  await client.evaluate(
    async (datasetKey: string, expectedValue: string) => {
      await new Promise<void>((resolve, reject) => {
        const startedAt = Date.now();
        const tick = () => {
          if (document.documentElement.dataset[datasetKey] === expectedValue) {
            resolve();
            return;
          }
          if (Date.now() - startedAt > 5000) {
            reject(new Error(`Timed out waiting for appearance dataset ${datasetKey}=${expectedValue}.`));
            return;
          }
          window.setTimeout(tick, 100);
        };
        tick();
      });
      return true;
    },
    key,
    value,
  );
}

async function waitForTarget(predicate: (target: DebugTarget) => boolean): Promise<DebugTarget> {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const targets = await readTargets();
    const match = targets.find(predicate);
    if (match) return match;
    await delay(500);
  }
  throw new Error("Timed out waiting for desktop debug target.");
}

function readTargets(): Promise<DebugTarget[]> {
  return new Promise((resolve, reject) => {
    http
      .get(`${endpoint}/json/list`, (response) => {
        let body = "";
        response.setEncoding("utf8");
        response.on("data", (chunk) => {
          body += chunk;
        });
        response.on("end", () => {
          resolve(JSON.parse(body) as DebugTarget[]);
        });
      })
      .on("error", reject);
  });
}

function isMainWindowTarget(url: string): boolean {
  return url.endsWith("/Frontend/dist/index.html") || /^https?:\/\/127\.0\.0\.1:5173\/?($|[?#])/.test(url);
}

async function createCdpClient(url: string): Promise<{
  evaluate<T, TArgs extends unknown[] = []>(
    fn: (...args: TArgs) => T | Promise<T>,
    ...args: TArgs
  ): Promise<Awaited<T>>;
  close(): void;
}> {
  const ws = new WebSocket(url);
  await new Promise<void>((resolve, reject) => {
    ws.once("open", resolve);
    ws.once("error", reject);
  });

  let nextId = 1;
  const pending = new Map<
    number,
    {
      resolve: (value: unknown) => void;
      reject: (error: Error) => void;
    }
  >();

  ws.on("message", (data) => {
    const message = JSON.parse(String(data)) as CdpResponse;
    if (!message.id) return;
    const request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id);
    if (message.error) {
      request.reject(new Error(message.error.data ?? message.error.message));
      return;
    }
    request.resolve(message.result);
  });

  function send(method: string, params: Record<string, unknown>): Promise<unknown> {
    const id = nextId;
    nextId += 1;
    ws.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
    });
  }

  async function evaluate<T, TArgs extends unknown[] = []>(
    fn: (...args: TArgs) => T | Promise<T>,
    ...args: TArgs
  ): Promise<Awaited<T>> {
    const result = (await send("Runtime.evaluate", {
      expression: `(async () => { const __name = (target) => target; return JSON.stringify(await (${fn.toString()})(...${JSON.stringify(args)})); })()`,
      awaitPromise: true,
      returnByValue: true,
    })) as {
      result?: { value?: string };
      exceptionDetails?: { text?: string; exception?: { description?: string } };
    };
    if (result.exceptionDetails) {
      throw new Error(
        result.exceptionDetails.exception?.description ?? result.exceptionDetails.text ?? "CDP evaluation failed",
      );
    }
    if (typeof result.result?.value !== "string") {
      throw new Error("CDP evaluation returned no JSON value.");
    }
    return JSON.parse(result.result.value) as Awaited<T>;
  }

  return {
    evaluate,
    close: () => ws.close(),
  };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

declare global {
  interface Window {
    seneraDesktop?: {
      openSettings(options?: { section?: string }): Promise<void>;
    };
  }
}
