import { AgentXmlLexicalScanner } from "./AgentXmlLexicalScanner.js";

const SharedXmlLexicalScanner = new AgentXmlLexicalScanner();

export function readXmlRootName(xml: string): string | undefined {
  return SharedXmlLexicalScanner.readLeadingTag(xml)?.name;
}
