import { describe, expect, test } from "vitest";
import { AgentXmlCodec } from "../../../Source/AgentSystem/Xml/AgentXmlCodec.js";
import { AgentXmlParser } from "../../../Source/AgentSystem/Xml/AgentXmlParser.js";
import { createXmlProtocolPolicy } from "../../../Source/AgentSystem/Xml/AgentXmlPolicy.js";
import { AgentXmlParseError } from "../../../Source/AgentSystem/Xml/AgentXmlParserTypes.js";
import { AgentXmlErrorCodes } from "../../../Source/AgentSystem/Xml/AgentXmlStatus.js";
import type { AgentSystemConfig } from "../../../Source/AgentSystem/Types/AgentConfigTypes.js";

describe("XML parser and codec", () => {
  test("round-trips nested objects and array item elements", () => {
    const parser = new AgentXmlParser({
      arrayElementNames: ["item"],
    });
    const codec = new AgentXmlCodec();

    const xml = codec.objectToXml("tool_results", {
      status: "success",
      items: ["alpha", "beta"],
      nested: {
        value: "<escaped>",
      },
    });
    const parsed = parser.parse(xml);

    expect(parsed.rootName).toBe("tool_results");
    expect(parsed.value).toMatchObject({
      status: "success",
      items: {
        item: ["alpha", "beta"],
      },
      nested: {
        value: "<escaped>",
      },
    });
  });

  test("rejects forbidden XML syntax with source diagnostics", () => {
    const policy = createXmlProtocolPolicy(createConfig());
    const parser = new AgentXmlParser({ policy });

    expect(() => parser.parse("<!DOCTYPE root><root />")).toThrow(AgentXmlParseError);
    try {
      parser.parse("<!DOCTYPE root><root />");
    } catch (error) {
      expect(error).toBeInstanceOf(AgentXmlParseError);
      expect((error as AgentXmlParseError).diagnostics[0]?.frame?.text).toContain("<!DOCTYPE root>");
    }
  });

  test("honors configured depth and text limits", () => {
    const shallowParser = new AgentXmlParser({ maxDepth: 2 });
    expect(() => shallowParser.parse("<root><a><b>too deep</b></a></root>")).toThrow(AgentXmlParseError);

    const smallParser = new AgentXmlParser({ maxTextLength: 10 });
    expect(() => smallParser.parse("<root>this text is too long</root>")).toThrow(AgentXmlParseError);
  });

  test("serializes primitive values through a stable value wrapper", () => {
    const parser = new AgentXmlParser();
    const xml = parser.serialize("answer", "done");
    const parsed = parser.parse(xml);

    expect(parsed.rootName).toBe("answer");
    expect(parsed.value).toEqual({ value: "done" });
  });

  test.each([
    {
      name: "an incomplete document",
      xml: "<root>",
      expectedCode: AgentXmlErrorCodes.InvalidXmlSyntax,
    },
    {
      name: "multiple roots",
      xml: "<first /><second />",
      expectedCode: AgentXmlErrorCodes.InvalidXmlSyntax,
    },
    {
      name: "text after the root",
      xml: "<root /> trailing",
      expectedCode: AgentXmlErrorCodes.InvalidXmlSyntax,
    },
    {
      name: "a Markdown-fenced document",
      xml: "```xml\n<root />\n```",
      expectedCode: AgentXmlErrorCodes.InvalidXmlSyntax,
    },
  ])("rejects $name", ({ xml, expectedCode }) => {
    const parser = new AgentXmlParser();
    const error = captureXmlParseError(() => parser.parse(xml));

    expect(error.code).toBe(expectedCode);
  });
});

function captureXmlParseError(action: () => unknown): AgentXmlParseError {
  try {
    action();
  } catch (error) {
    if (error instanceof AgentXmlParseError) {
      return error;
    }
    throw error;
  }

  throw new Error("Expected XML parsing to fail.");
}

function createConfig(): AgentSystemConfig {
  return {
    DefaultModelProviderId: "main",
    ModelProviderEndpoints: [
      {
        Id: "main",
        BaseUrl: "https://example.invalid/v1",
        ApiKey: "test",
      },
    ],
    ModelProviders: [
      {
        Id: "main",
        ProviderId: "main",
        Endpoint: "ChatCompletions",
        Model: "test-model",
      },
    ],
  };
}
