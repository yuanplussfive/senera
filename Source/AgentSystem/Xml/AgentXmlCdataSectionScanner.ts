export const AgentXmlCdataSyntax = {
  Start: "<![CDATA[",
  End: "]]>",
} as const;

export type AgentXmlCdataScanResult =
  | {
      ok: true;
    }
  | {
      ok: false;
      startOffset: number;
    };

export class AgentXmlCdataSectionScanner {
  scan(source: string): AgentXmlCdataScanResult {
    let offset = 0;

    while (offset < source.length) {
      if (!source.startsWith(AgentXmlCdataSyntax.Start, offset)) {
        offset += 1;
        continue;
      }

      const sectionStart = offset;
      offset += AgentXmlCdataSyntax.Start.length;
      const endOffset = this.findSectionEnd(source, offset);
      if (endOffset === undefined) {
        return {
          ok: false,
          startOffset: sectionStart,
        };
      }

      offset = endOffset + AgentXmlCdataSyntax.End.length;
    }

    return {
      ok: true,
    };
  }

  private findSectionEnd(source: string, fromOffset: number): number | undefined {
    for (let offset = fromOffset; offset < source.length; offset += 1) {
      if (source.startsWith(AgentXmlCdataSyntax.End, offset)) {
        return offset;
      }
    }

    return undefined;
  }
}
