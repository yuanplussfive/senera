import { describe, expect, test } from "vitest";
import {
  escapeXmlAttribute,
  escapeXmlText,
  formatXmlAttribute,
  formatXmlAttributes,
  formatXmlOpenTag,
  formatXmlCloseTag,
  formatSelfClosingXmlBlock,
  formatXmlBlock,
  formatXmlBlockRaw,
  type XmlAttribute,
} from "../../../Source/AgentSystem/Xml/AgentXmlFormat.js";

describe("AgentXmlFormat", () => {
  describe("escapeXmlAttribute", () => {
    test("escapes ampersand, angle brackets, quotes, and apostrophe", () => {
      expect(escapeXmlAttribute("a&b<c>\"d'e")).toBe("a&amp;b&lt;c&gt;&quot;d&apos;e");
    });

    test("returns empty string for null", () => {
      expect(escapeXmlAttribute(null)).toBe("");
    });

    test("returns empty string for undefined", () => {
      expect(escapeXmlAttribute(undefined)).toBe("");
    });

    test("coerces number to string", () => {
      expect(escapeXmlAttribute(42)).toBe("42");
    });

    test("coerces boolean to string", () => {
      expect(escapeXmlAttribute(true)).toBe("true");
    });

    test("escapes ampersand before other entities to avoid double-escaping", () => {
      expect(escapeXmlAttribute("&amp;")).toBe("&amp;amp;");
    });

    test("handles empty string", () => {
      expect(escapeXmlAttribute("")).toBe("");
    });

    test("leaves non-special characters unchanged", () => {
      expect(escapeXmlAttribute("hello world 123")).toBe("hello world 123");
    });
  });

  describe("escapeXmlText", () => {
    test("escapes ampersand, angle brackets only", () => {
      expect(escapeXmlText("a&b<c>d\"e'f")).toBe("a&amp;b&lt;c&gt;d\"e'f");
    });

    test("returns empty string for null", () => {
      expect(escapeXmlText(null)).toBe("");
    });

    test("returns empty string for undefined", () => {
      expect(escapeXmlText(undefined)).toBe("");
    });

    test("coerces number to string", () => {
      expect(escapeXmlText(0)).toBe("0");
    });

    test("coerces boolean to string", () => {
      expect(escapeXmlText(false)).toBe("false");
    });

    test("handles empty string", () => {
      expect(escapeXmlText("")).toBe("");
    });

    test("does not escape quotes or apostrophes", () => {
      expect(escapeXmlText("\"quote\" 'apos'")).toBe("\"quote\" 'apos'");
    });
  });

  describe("formatXmlAttribute", () => {
    test("formats name=value pair with escaped value", () => {
      expect(formatXmlAttribute(["id", "abc&123"])).toBe('id="abc&amp;123"');
    });

    test("returns empty string for null value", () => {
      expect(formatXmlAttribute(["id", null])).toBe("");
    });

    test("returns empty string for undefined value", () => {
      expect(formatXmlAttribute(["id", undefined])).toBe("");
    });

    test("returns empty string for empty string value", () => {
      expect(formatXmlAttribute(["id", ""])).toBe("");
    });

    test("formats numeric value", () => {
      expect(formatXmlAttribute(["step", 3])).toBe('step="3"');
    });

    test("formats boolean value", () => {
      expect(formatXmlAttribute(["flag", true])).toBe('flag="true"');
    });
  });

  describe("formatXmlAttributes", () => {
    test("joins multiple attributes with space", () => {
      const attrs: readonly XmlAttribute[] = [
        ["id", "abc"],
        ["step", 2],
      ];
      expect(formatXmlAttributes(attrs)).toBe('id="abc" step="2"');
    });

    test("skips attributes with absent values", () => {
      const attrs: readonly XmlAttribute[] = [
        ["id", "abc"],
        ["step", undefined],
        ["name", null],
        ["flag", true],
      ];
      expect(formatXmlAttributes(attrs)).toBe('id="abc" flag="true"');
    });

    test("returns empty string for empty array", () => {
      expect(formatXmlAttributes([])).toBe("");
    });

    test("returns empty string when all attributes are absent", () => {
      const attrs: readonly XmlAttribute[] = [
        ["a", null],
        ["b", undefined],
        ["c", ""],
      ];
      expect(formatXmlAttributes(attrs)).toBe("");
    });
  });

  describe("formatXmlOpenTag", () => {
    test("builds opening tag with attributes", () => {
      expect(formatXmlOpenTag("call", [["index", 0]])).toBe('<call index="0">');
    });

    test("builds opening tag without attributes", () => {
      expect(formatXmlOpenTag("message")).toBe("<message>");
    });

    test("uses empty array as default attributes", () => {
      expect(formatXmlOpenTag("user")).toBe("<user>");
    });
  });

  describe("formatXmlCloseTag", () => {
    test("builds closing tag", () => {
      expect(formatXmlCloseTag("call")).toBe("</call>");
    });
  });

  describe("formatSelfClosingXmlBlock", () => {
    test("builds self-closing tag with attributes", () => {
      expect(formatSelfClosingXmlBlock("result", [["status", "ok"]])).toBe('<result status="ok" />');
    });

    test("builds self-closing tag without attributes", () => {
      expect(formatSelfClosingXmlBlock("empty")).toBe("<empty />");
    });
  });

  describe("formatXmlBlock", () => {
    test("builds full block with escaped content", () => {
      expect(formatXmlBlock("preface", [], "hello & world")).toBe("<preface>\nhello &amp; world\n</preface>");
    });

    test("emits self-closing tag when content is empty", () => {
      expect(formatXmlBlock("empty", [], "")).toBe("<empty />");
    });

    test("emits self-closing tag when content is whitespace only", () => {
      expect(formatXmlBlock("empty", [], "   \n\t  ")).toBe("<empty />");
    });

    test("trims leading and trailing whitespace from content", () => {
      expect(formatXmlBlock("msg", [], "  hello  ")).toBe("<msg>\nhello\n</msg>");
    });

    test("includes attributes in opening tag", () => {
      expect(formatXmlBlock("call", [["index", 1]], "args")).toBe('<call index="1">\nargs\n</call>');
    });

    test("escapes special XML characters in content", () => {
      expect(formatXmlBlock("msg", [], "a < b & c > d")).toBe("<msg>\na &lt; b &amp; c &gt; d\n</msg>");
    });

    test("does not escape quotes in text content", () => {
      expect(formatXmlBlock("msg", [], 'say "hi"')).toBe('<msg>\nsay "hi"\n</msg>');
    });
  });

  describe("formatXmlBlockRaw", () => {
    test("builds full block without escaping content", () => {
      expect(formatXmlBlockRaw("call", [], '{"a": "<b>"}')).toBe('<call>\n{"a": "<b>"}\n</call>');
    });

    test("emits self-closing tag when content is empty", () => {
      expect(formatXmlBlockRaw("empty", [], "")).toBe("<empty />");
    });

    test("emits self-closing tag when content is whitespace only", () => {
      expect(formatXmlBlockRaw("empty", [], "  \n  ")).toBe("<empty />");
    });

    test("trims leading and trailing whitespace from content", () => {
      expect(formatXmlBlockRaw("call", [], '  {"x": 1}  ')).toBe('<call>\n{"x": 1}\n</call>');
    });

    test("includes attributes in opening tag", () => {
      expect(formatXmlBlockRaw("call", [["name", "search"]], '{"q": "test"}')).toBe(
        '<call name="search">\n{"q": "test"}\n</call>',
      );
    });

    test("preserves JSON with special characters unescaped", () => {
      const json = '{"msg": "a < b & c"}';
      expect(formatXmlBlockRaw("call", [], json)).toBe(`<call>\n${json}\n</call>`);
    });
  });
});
