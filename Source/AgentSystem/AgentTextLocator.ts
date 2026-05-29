export interface AgentTextLineBoundary {
  content: string;
  terminated: boolean;
  nextOffset: number;
}

export interface AgentSourceOffsetMap {
  readonly lineStarts: readonly number[];
}

export class AgentTextLocator {
  stripBom(text: string): string {
    return text.codePointAt(0) === 0xfeff ? text.slice(1) : text;
  }

  firstNonWhitespaceOffset(text: string): number {
    const offset = text.search(/\S/u);
    return offset < 0 ? text.length : offset;
  }

  readLeadingContent(text: string): string | undefined {
    const offset = this.firstNonWhitespaceOffset(text);
    return offset >= text.length ? undefined : text.slice(offset);
  }

  readLineBoundary(text: string): AgentTextLineBoundary {
    const match = /\r\n|\r|\n/u.exec(text);
    return match?.index === undefined
      ? {
          content: text,
          terminated: false,
          nextOffset: text.length,
        }
      : {
          content: text.slice(0, match.index),
          terminated: true,
          nextOffset: match.index + match[0].length,
        };
  }

  createOffsetMap(source: string): AgentSourceOffsetMap {
    return {
      lineStarts: [
        0,
        ...Array.from(
          source.matchAll(/\r\n|\r|\n/gu),
          (entry) => (entry.index ?? 0) + entry[0].length,
        ),
      ],
    };
  }

  offsetFromLineColumn(
    source: string,
    line: number,
    column: number,
  ): number {
    const map = this.createOffsetMap(source);
    const lineStart = map.lineStarts[Math.max(0, line - 1)] ?? source.length;
    return Math.min(source.length, lineStart + Math.max(0, column - 1));
  }

  positionFromOffset(
    source: string,
    offset: number,
  ): { line: number; column: number; position: number } {
    const boundedOffset = Math.max(0, Math.min(offset, source.length));
    const entry = this.createOffsetMap(source).lineStarts.reduce(
      (state, lineStart, index) =>
        lineStart <= boundedOffset
          ? {
              line: index + 1,
              start: lineStart,
            }
          : state,
      {
        line: 1,
        start: 0,
      },
    );

    return {
      line: entry.line,
      column: boundedOffset - entry.start + 1,
      position: boundedOffset,
    };
  }
}
