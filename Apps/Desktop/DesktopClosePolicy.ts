export type DesktopCloseIntent = "settings" | "main" | "quit";

export class DesktopClosePolicy {
  #dirty = false;
  #pendingIntent: DesktopCloseIntent | undefined;

  get dirty(): boolean {
    return this.#dirty;
  }

  setDirty(dirty: boolean): void {
    this.#dirty = dirty;
  }

  request(intent: DesktopCloseIntent): boolean {
    if (!this.#dirty) return false;
    this.#pendingIntent = selectDesktopCloseIntent(this.#pendingIntent, intent);
    return true;
  }

  cancel(): void {
    this.#pendingIntent = undefined;
  }

  confirm(fallback: DesktopCloseIntent = "settings"): DesktopCloseIntent {
    const intent = this.#pendingIntent ?? fallback;
    this.#dirty = false;
    this.#pendingIntent = undefined;
    return intent;
  }

  reset(): void {
    this.#dirty = false;
    this.#pendingIntent = undefined;
  }
}

export function selectDesktopCloseIntent(
  current: DesktopCloseIntent | undefined,
  next: DesktopCloseIntent,
): DesktopCloseIntent {
  const priority = { settings: 0, main: 1, quit: 2 } as const;
  return current && priority[current] >= priority[next] ? current : next;
}
