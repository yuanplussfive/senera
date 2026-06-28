import fs from "node:fs";
import ts from "typescript";
import { AgentXmlCodec } from "../Xml/AgentXmlCodec.js";
import { createXmlProtocolSpec } from "../Xml/AgentXmlPolicy.js";
import { AgentPromptContractAstReader } from "./AgentPromptContractAstReader.js";
import { AgentPromptContractRenderer } from "./AgentPromptContractRenderer.js";
import { createPromptContractJsonSchema } from "./AgentPromptContractJsonSchema.js";
import type { AgentPromptContractView } from "./AgentPromptContractTypes.js";

export type {
  AgentPromptContractProperty,
  AgentPromptContractView,
} from "./AgentPromptContractTypes.js";

export class AgentPromptContractProjector {
  private readonly protocol = createXmlProtocolSpec();
  private readonly reader = new AgentPromptContractAstReader({
    arrayItemName: this.protocol.items.arrayItem,
  });
  private readonly renderer = new AgentPromptContractRenderer({
    xmlCodec: new AgentXmlCodec(this.protocol),
    arrayItemName: this.protocol.items.arrayItem,
  });

  projectFromFile(
    signatureFile: string | undefined,
    rootName: string,
    typeName?: string,
  ): AgentPromptContractView | undefined {
    if (!signatureFile) {
      return undefined;
    }

    const sourceText = fs.readFileSync(signatureFile, "utf8");
    return this.projectFromSource(sourceText, signatureFile, rootName, typeName);
  }

  projectFromSource(
    sourceText: string,
    sourceFilePath: string,
    rootName: string,
    typeName?: string,
  ): AgentPromptContractView {
    const sourceFile = ts.createSourceFile(
      sourceFilePath,
      sourceText,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TS,
    );
    const rootDeclaration = this.reader.readRootTypeDeclaration(sourceFile, typeName);
    const properties = this.reader.readProperties(rootDeclaration.type, sourceFile, rootName, 0);

    return {
      tsHintLines: this.renderer.renderTsHintLines(rootName, properties),
      xmlPreview: this.renderer.renderXmlPreview(rootName, properties),
      properties: properties.map((property) => this.renderer.toPromptProperty(property)),
      jsonSchema: createPromptContractJsonSchema(sourceFilePath, rootDeclaration.name.text),
    };
  }
}
