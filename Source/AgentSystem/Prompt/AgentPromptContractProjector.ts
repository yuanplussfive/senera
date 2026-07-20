import fs from "node:fs";
import crypto from "node:crypto";
import ts from "typescript";
import { AgentXmlCodec } from "../Xml/AgentXmlCodec.js";
import { createXmlProtocolSpec } from "../Xml/AgentXmlPolicy.js";
import { AgentPromptContractAstReader } from "./AgentPromptContractAstReader.js";
import { AgentPromptContractRenderer } from "./AgentPromptContractRenderer.js";
import { AgentPromptContractJsonSchemaCatalog } from "./AgentPromptContractJsonSchema.js";
import type { AgentPromptContractView } from "./AgentPromptContractTypes.js";

export type { AgentPromptContractProperty, AgentPromptContractView } from "./AgentPromptContractTypes.js";

export class AgentPromptContractProjector {
  private readonly protocol = createXmlProtocolSpec();
  private readonly reader = new AgentPromptContractAstReader({
    arrayItemName: this.protocol.items.arrayItem,
  });
  private readonly renderer = new AgentPromptContractRenderer({
    xmlCodec: new AgentXmlCodec(this.protocol),
    arrayItemName: this.protocol.items.arrayItem,
  });
  private readonly schemaCatalog = new AgentPromptContractJsonSchemaCatalog();
  private readonly fileCache = new Map<string, { sourceText: string; sourceDigest: string }>();
  private readonly contractCache = new Map<string, AgentPromptContractView>();

  projectFromFile(
    signatureFile: string | undefined,
    rootName: string,
    typeName?: string,
  ): AgentPromptContractView | undefined {
    if (!signatureFile) {
      return undefined;
    }

    const source = this.readSource(signatureFile);
    const cacheKey = JSON.stringify([signatureFile, source.sourceDigest, rootName, typeName ?? ""]);
    const cached = this.contractCache.get(cacheKey);
    if (cached) return cached;

    const contract = this.projectFromSource(source.sourceText, signatureFile, rootName, typeName, source.sourceDigest);
    this.contractCache.set(cacheKey, contract);
    return contract;
  }

  projectFromSource(
    sourceText: string,
    sourceFilePath: string,
    rootName: string,
    typeName?: string,
    sourceDigest = digestSource(sourceText),
  ): AgentPromptContractView {
    const sourceFile = ts.createSourceFile(sourceFilePath, sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    const rootDeclaration = this.reader.readRootTypeDeclaration(sourceFile, typeName);
    const properties = this.reader.readProperties(rootDeclaration.type, sourceFile, rootName, 0);

    return {
      tsHintLines: this.renderer.renderTsHintLines(rootName, properties),
      xmlPreview: this.renderer.renderXmlPreview(rootName, properties),
      properties: properties.map((property) => this.renderer.toPromptProperty(property)),
      jsonSchema: this.schemaCatalog.create(sourceFilePath, rootDeclaration.name.text, sourceDigest),
    };
  }

  private readSource(sourceFilePath: string): { sourceText: string; sourceDigest: string } {
    const sourceText = fs.readFileSync(sourceFilePath, "utf8");
    const sourceDigest = digestSource(sourceText);
    const cached = this.fileCache.get(sourceFilePath);
    if (cached?.sourceDigest === sourceDigest) return cached;

    const source = { sourceText, sourceDigest };
    this.fileCache.set(sourceFilePath, source);
    return source;
  }
}

function digestSource(sourceText: string): string {
  return crypto.createHash("sha256").update(sourceText).digest("hex");
}
