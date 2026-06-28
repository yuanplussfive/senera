export interface AgentXmlCandidateOffsetScanOptions {
  includeFenced?: boolean;
}

interface MarkdownFence {
  marker: "`" | "~";
  size: number;
}

export class AgentXmlCandidateOffsetScanner {
  *findOffsets(
    text: string,
    options: AgentXmlCandidateOffsetScanOptions = {},
  ): Iterable<number> {
    if (options.includeFenced === false) {
      yield* this.findOffsetsOutsideMarkdownFences(text);
      return;
    }

    yield* this.findOffsetsInText(text);
  }

  private *findOffsetsInText(text: string): Iterable<number> {
    let offset = text.indexOf("<");
    while (offset !== -1) {
      yield offset;
      offset = text.indexOf("<", offset + 1);
    }
  }

  private *findOffsetsOutsideMarkdownFences(text: string): Iterable<number> {
    let fence: MarkdownFence | undefined;
    let lineStart = 0;

    while (lineStart <= text.length) {
      const lineEnd = this.findLineEnd(text, lineStart);
      const line = text.slice(lineStart, lineEnd.contentEnd);
      const marker = this.readFenceMarker(line);

      if (fence) {
        if (marker && marker.marker === fence.marker && marker.size >= fence.size) {
          fence = undefined;
        }
      } else if (marker) {
        fence = marker;
      } else {
        yield* this.findLineOffsets(text, lineStart, lineEnd.contentEnd);
      }

      if (lineEnd.nextStart === undefined) {
        break;
      }
      lineStart = lineEnd.nextStart;
    }
  }

  private *findLineOffsets(
    text: string,
    start: number,
    end: number,
  ): Iterable<number> {
    let offset = text.indexOf("<", start);
    while (offset !== -1 && offset < end) {
      yield offset;
      offset = text.indexOf("<", offset + 1);
    }
  }

  private findLineEnd(
    text: string,
    start: number,
  ): {
    contentEnd: number;
    nextStart?: number;
  } {
    const lf = text.indexOf("\n", start);
    if (lf === -1) {
      return {
        contentEnd: text.length,
      };
    }

    return {
      contentEnd: lf > start && text[lf - 1] === "\r" ? lf - 1 : lf,
      nextStart: lf + 1,
    };
  }

  private readFenceMarker(line: string): MarkdownFence | undefined {
    const content = this.trimOpeningIndent(line);
    const marker = content[0];
    if (marker !== "`" && marker !== "~") {
      return undefined;
    }

    const size = this.countLeading(content, marker);
    return size >= 3
      ? {
          marker,
          size,
        }
      : undefined;
  }

  private trimOpeningIndent(line: string): string {
    let offset = 0;
    while (offset < line.length && offset < 3 && line[offset] === " ") {
      offset += 1;
    }
    return line.slice(offset);
  }

  private countLeading(text: string, marker: "`" | "~"): number {
    let count = 0;
    while (text[count] === marker) {
      count += 1;
    }
    return count;
  }
}
