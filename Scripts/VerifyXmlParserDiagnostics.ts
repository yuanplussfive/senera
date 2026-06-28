import assert from "node:assert/strict";
import {
  AgentXmlParseError,
  AgentXmlParser,
} from "../Source/AgentSystem/Xml/AgentXmlParser.js";
import { createXmlProtocolPolicy } from "../Source/AgentSystem/Xml/AgentXmlPolicy.js";
import { AgentXmlErrorCodes } from "../Source/AgentSystem/Xml/AgentXmlStatus.js";
import type { AgentSystemConfig } from "../Source/AgentSystem/Types/AgentConfigTypes.js";

const policy = createXmlProtocolPolicy({
  ModelProviders: [],
  PluginRoots: {
    System: [],
    User: [],
  },
} satisfies AgentSystemConfig);

const parser = new AgentXmlParser({
  policy,
});

const cdataWithForbiddenText = parser.parse("<root><value><![CDATA[<!DOCTYPE note><x/>]]></value></root>");
assert.equal(cdataWithForbiddenText.rootName, "root");
assert.deepEqual(cdataWithForbiddenText.value, {
  value: "<!DOCTYPE note><x/>",
});

assertXmlError(
  "<!DOCTYPE note><root></root>",
  AgentXmlErrorCodes.ForbiddenXmlSyntax,
  "DOCTYPE",
);

assertXmlError(
  "<?xml-stylesheet href='x'?><root></root>",
  AgentXmlErrorCodes.ForbiddenXmlSyntax,
  "processing instruction",
);

assertXmlError(
  "<root><value><![CDATA[missing close</value></root>",
  AgentXmlErrorCodes.InvalidXmlSyntax,
  "unclosed_cdata",
);

assertXmlError(
  "<root><value>one</value><value>two</value></root>",
  AgentXmlErrorCodes.DuplicateSiblingTag,
  "value",
);

console.log("XML parser diagnostics verification passed.");

function assertXmlError(
  xml: string,
  code: string,
  expectedDetail: string,
): void {
  assert.throws(
    () => parser.parse(xml),
    (error) => {
      assert.equal(error instanceof AgentXmlParseError, true);
      const xmlError = error as AgentXmlParseError;
      assert.equal(xmlError.code, code);
      assert.match(JSON.stringify(xmlError.details ?? {}), new RegExp(expectedDetail));
      assert.equal(xmlError.diagnostics.length > 0, true);
      return true;
    },
  );
}
