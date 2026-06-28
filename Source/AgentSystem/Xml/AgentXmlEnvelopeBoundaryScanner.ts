import { SaxesParser, type SaxesTagPlain } from "saxes";

export type AgentXmlEnvelopeBoundaryScan =
  | {
      kind: "complete";
      end: number;
      rootName: string;
    }
  | {
      kind: "incomplete";
      rootName?: string;
      error?: Error;
      errorOffset?: number;
    };

export class AgentXmlEnvelopeBoundaryScanner {
  findFirstCompleteBoundary(xmlText: string, fromOffset = 0): number | undefined {
    const scan = this.scanFirstCompleteBoundary(xmlText, fromOffset);
    return scan.kind === "complete" ? scan.end : undefined;
  }

  scanFirstCompleteBoundary(
    xmlText: string,
    fromOffset = 0,
  ): AgentXmlEnvelopeBoundaryScan {
    const start = Math.max(0, fromOffset);
    const parser = new SaxesParser({
      fragment: true,
      xmlns: false,
      position: true,
    });
    let depth = 0;
    let rootName: string | undefined;
    let completeEnd: number | undefined;
    let error: Error | undefined;
    let errorOffset: number | undefined;

    parser.on("opentag", (tag: SaxesTagPlain) => {
      if (completeEnd !== undefined || error) {
        return;
      }

      if (depth === 0 && rootName === undefined) {
        rootName = tag.name;
      }

      depth += 1;
    });

    parser.on("closetag", () => {
      if (completeEnd !== undefined || error) {
        return;
      }

      depth = Math.max(0, depth - 1);
      if (rootName !== undefined && depth === 0) {
        completeEnd = start + parser.position;
      }
    });

    parser.on("error", (entry: Error) => {
      if (!error) {
        error = entry;
        errorOffset = start + parser.position;
      }
    });

    try {
      parser.write(xmlText.slice(start));
    } catch (entry) {
      error = entry instanceof Error ? entry : new Error(String(entry));
      errorOffset = start + parser.position;
    }

    if (completeEnd !== undefined && (errorOffset === undefined || errorOffset > completeEnd)) {
      return {
        kind: "complete",
        end: completeEnd,
        rootName: rootName ?? "",
      };
    }

    return {
      kind: "incomplete",
      rootName,
      error,
      errorOffset,
    };
  }
}
