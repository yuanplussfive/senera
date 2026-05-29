export interface AgentXmlTagToken {
  kind: "open" | "close";
  name: string;
  selfClosing: boolean;
}

export class AgentXmlLexicalScanner {
  readLeadingTag(text: string): AgentXmlTagToken | undefined {
    const boundary = this.findFirstTagBoundary(text);
    return boundary === undefined
      ? undefined
      : this.parseTagToken(text.slice(0, boundary));
  }

  readTagAt(text: string, offset: number): AgentXmlTagToken | undefined {
    const boundedOffset = Math.max(0, Math.min(offset, text.length));
    return this.readLeadingTag(text.slice(boundedOffset));
  }

  private findFirstTagBoundary(text: string): number | undefined {
    let readingTag = false;
    let quote: '"' | "'" | undefined;

    for (let index = 0; index < text.length; index += 1) {
      const char = text[index];
      if (!readingTag) {
        if (char === "<") {
          readingTag = true;
        }
        continue;
      }

      if (quote) {
        if (char === quote) {
          quote = undefined;
        }
        continue;
      }

      if (char === '"' || char === "'") {
        quote = char;
        continue;
      }

      if (char === ">") {
        return index + 1;
      }
    }

    return undefined;
  }

  private parseTagToken(buffer: string): AgentXmlTagToken | undefined {
    const text = buffer.trim();
    if (!text.startsWith("<") || !text.endsWith(">")) {
      return undefined;
    }

    const inner = text.slice(1, -1).trim();
    if (inner.length === 0 || inner.startsWith("!") || inner.startsWith("?")) {
      return undefined;
    }

    const closing = inner.startsWith("/");
    const core = closing ? inner.slice(1).trim() : inner;
    const selfClosing = !closing && core.endsWith("/");
    const name = (selfClosing ? core.slice(0, -1) : core).trim().split(/\s+/)[0] ?? "";

    return /^[A-Za-z_][\w.\-]*$/.test(name)
      ? {
          kind: closing ? "close" : "open",
          name,
          selfClosing,
        }
      : undefined;
  }
}
