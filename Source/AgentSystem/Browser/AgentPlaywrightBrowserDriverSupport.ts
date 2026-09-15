import type { ElementHandle, Locator, Page } from "playwright-core";

const MaxSnapshotLabelLength = 240;

export interface BrowserTabState {
  readonly id: string;
  readonly label?: string;
}

export function isElementHandle(target: Locator | ElementHandle<Node>): target is ElementHandle<Node> {
  return "asElement" in target;
}

export function requiredString(input: Readonly<Record<string, unknown>>, name: string): string {
  const value = input[name];
  if (typeof value !== "string") throw new Error(`Browser operation requires a string ${name}.`);
  return value;
}

export function optionalString(input: Readonly<Record<string, unknown>>, name: string): string | undefined {
  const value = input[name];
  return typeof value === "string" ? value : undefined;
}

export function optionalNumber(input: Readonly<Record<string, unknown>>, name: string): number | undefined {
  const value = input[name];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

export function optionalBoolean(input: Readonly<Record<string, unknown>>, name: string): boolean | undefined {
  const value = input[name];
  return typeof value === "boolean" ? value : undefined;
}

export function requiredStringArray(input: Readonly<Record<string, unknown>>, name: string): string[] {
  const value = input[name];
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) {
    throw new Error(`Browser operation requires string array ${name}.`);
  }
  return value;
}

export function scrollDelta(direction: string, amount: number): { readonly left: number; readonly top: number } {
  switch (direction) {
    case "up":
      return { left: 0, top: -amount };
    case "left":
      return { left: -amount, top: 0 };
    case "right":
      return { left: amount, top: 0 };
    default:
      return { left: 0, top: amount };
  }
}

export async function snapshotElementDescriptor(
  handle: ElementHandle<Node>,
  includeUrls: boolean,
): Promise<string | undefined> {
  return handle.evaluate(
    (element, options) => {
      const html = element as HTMLElement;
      const style = getComputedStyle(html);
      const rect = html.getBoundingClientRect();
      if (style.display === "none" || style.visibility === "hidden" || rect.width === 0 || rect.height === 0)
        return undefined;
      const role = html.getAttribute("role") || html.tagName.toLowerCase();
      const label = [
        html.getAttribute("aria-label"),
        html.getAttribute("title"),
        html.getAttribute("placeholder"),
        html.innerText,
        html.getAttribute("value"),
      ]
        .find((value) => typeof value === "string" && value.trim())
        ?.replace(/\s+/gu, " ")
        .trim();
      const href = options.includeUrls && html instanceof HTMLAnchorElement ? html.href : undefined;
      return [role, label ? `"${label.slice(0, options.maxLabelLength)}"` : undefined, href].filter(Boolean).join(" ");
    },
    { includeUrls, maxLabelLength: MaxSnapshotLabelLength },
  );
}

export function compactSnapshot(value: string, compact: boolean): string {
  if (!compact) return value.trim();
  return value
    .split("\n")
    .map((line) => line.replace(/\s+/gu, " ").trim())
    .filter(Boolean)
    .join("\n");
}

export async function pageDescriptor(page: Page): Promise<string> {
  const title = await page.title().catch(() => "");
  return title ? `${title}\n${page.url()}` : page.url();
}

export function assertNotAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw signal.reason ?? new DOMException("Browser operation aborted.", "AbortError");
}

export function waitForDuration(ms: number, signal: AbortSignal | undefined): Promise<void> {
  assertNotAborted(signal);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", abort);
      resolve();
    }, ms);
    const abort = () => {
      clearTimeout(timer);
      reject(signal?.reason ?? new DOMException("Browser operation aborted.", "AbortError"));
    };
    signal?.addEventListener("abort", abort, { once: true });
  });
}
