import { expect, test } from "vitest";
import { decodeBase64Attachment } from "../../../Source/AgentSystem/Channels/AgentChannelAttachmentIngestor.js";

test("validates multi-megabyte inline media without exhausting the regexp stack", () => {
  const bytes = Buffer.alloc(5 * 1024 * 1024, 0xab);
  expect(decodeBase64Attachment(bytes.toString("base64"), bytes.length).equals(bytes)).toBe(true);
  expect(() => decodeBase64Attachment(bytes.toString("base64"), bytes.length - 1)).toThrow("limit");
});

test.each(["a", "ab=", "a===", "====", "aaaa=", "AA?=", "AA=A", ""])("rejects malformed inline data %j", (value) => {
  expect(() => decodeBase64Attachment(value, 1024)).toThrow("malformed");
});
