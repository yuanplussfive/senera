import { matchByKind } from "../AgentMatch.js";
import type { AgentTextLineBoundary } from "../AgentTextLocator.js";
import { AgentTextLocator } from "../AgentTextLocator.js";

export type AgentMarkdownFenceOpening =
  | {
      kind: "absent";
    }
  | {
      kind: "pending";
    }
  | {
      kind: "open";
      bodyOffset: number;
    };

export type AgentMarkdownFenceInspection =
  | {
      kind: "none";
    }
  | {
      kind: "prefix";
    }
  | {
      kind: "closed";
    }
  | {
      kind: "trailing_after_fence";
      offset: number;
    };

interface AgentFenceLineShape {
  valid: boolean;
  backticks: number;
}

export class AgentMarkdownFenceScanner {
  constructor(private readonly locator: AgentTextLocator) {}

  readOpening(
    text: string,
    isAllowedLanguage: (info: string) => boolean,
  ): AgentMarkdownFenceOpening {
    const line = this.locator.readLineBoundary(text);
    return matchByKind(this.readOpeningState(line, isAllowedLanguage), {
      absent: () => ({ kind: "absent" }),
      pending: () => ({ kind: "pending" }),
      open: () => ({
        kind: "open",
        bodyOffset: line.nextOffset,
      }),
    });
  }

  inspectClosing(
    text: string,
    allowPrefix: boolean,
  ): AgentMarkdownFenceInspection {
    const line = this.locator.readLineBoundary(text);
    const shape = this.inspectFenceLine(line.content);
    const trailing = text.slice(line.nextOffset);

    return matchByKind(
      this.readClosingState(line, shape, trailing, allowPrefix),
      {
        none: () => ({ kind: "none" }),
        prefix: () => ({ kind: "prefix" }),
        closed: () => ({ kind: "closed" }),
        trailing_after_fence: (entry) => ({
          kind: "trailing_after_fence",
          offset: entry.offset,
        }),
      },
    );
  }

  private readOpeningState(
    line: AgentTextLineBoundary,
    isAllowedLanguage: (info: string) => boolean,
  ):
    | { kind: "absent" }
    | { kind: "pending" }
    | { kind: "open" } {
    return matchByKind(this.inspectOpeningPrefix(line.content), {
      absent: () => ({ kind: "absent" }),
      pending: () => ({ kind: "pending" }),
      present: (entry) =>
        !line.terminated
          ? { kind: "pending" }
          : isAllowedLanguage(entry.info)
            ? { kind: "open" }
            : { kind: "pending" },
    });
  }

  private readClosingState(
    line: AgentTextLineBoundary,
    shape: AgentFenceLineShape,
    trailing: string,
    allowPrefix: boolean,
  ):
    | { kind: "none" }
    | { kind: "prefix" }
    | { kind: "closed" }
    | { kind: "trailing_after_fence"; offset: number } {
    return !shape.valid
      ? { kind: "none" }
      : !line.terminated
        ? shape.backticks >= 3
          ? { kind: "closed" }
          : allowPrefix && line.content.trim().length > 0
            ? { kind: "prefix" }
            : { kind: "none" }
        : shape.backticks < 3
          ? allowPrefix && line.content.trim().length > 0
            ? { kind: "prefix" }
            : { kind: "none" }
          : this.readClosedFenceState(line.nextOffset, trailing);
  }

  private readClosedFenceState(
    lineOffset: number,
    trailing: string,
  ):
    | { kind: "closed" }
    | { kind: "trailing_after_fence"; offset: number } {
    const trailingOffset = this.locator.firstNonWhitespaceOffset(trailing);
    return trailingOffset >= trailing.length
      ? { kind: "closed" }
      : {
          kind: "trailing_after_fence",
          offset: lineOffset + trailingOffset,
        };
  }

  private inspectOpeningPrefix(
    line: string,
  ):
    | { kind: "absent" }
    | { kind: "pending" }
    | { kind: "present"; info: string } {
    const backticks = this.countLeadingBackticks(line);
    const suffix = line.slice(backticks);
    return backticks === 0
      ? { kind: "absent" }
      : backticks < 3
        ? suffix.length === 0
          ? { kind: "pending" }
          : { kind: "absent" }
        : {
            kind: "present",
            info: suffix,
          };
  }

  private inspectFenceLine(line: string): AgentFenceLineShape {
    const chars = Array.from(line);
    return {
      valid: chars.every((char) => ["`", " ", "\t"].includes(char)),
      backticks: chars.reduce(
        (count, char) => count + Number(char === "`"),
        0,
      ),
    };
  }

  private countLeadingBackticks(line: string): number {
    return Array.from(line).reduce(
      (state, char) =>
        state.locked
          ? state
          : char === "`"
            ? { count: state.count + 1, locked: false }
            : { count: state.count, locked: true },
      { count: 0, locked: false },
    ).count;
  }
}
