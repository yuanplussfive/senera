/**
 * Shared low-level XML formatting primitives.
 *
 * Produces clean, model-readable XML blocks without code fences or redundant
 * wrappers. These utilities are intentionally framework-agnostic — semantic
 * mapping (which tag to use, what attributes to emit) is the caller's
 * responsibility. This module handles only the mechanical concerns of
 * attribute serialisation, escaping, and tag assembly.
 *
 * Both the ActionPlanner prompt projection layer and the Pi compaction
 * summary formatter import from here, ensuring a single source of truth for
 * XML escaping rules.
 */

/**
 * Characters that must be escaped inside XML attribute values.
 * The replacement map is applied after `&` to avoid double-escaping.
 */
const XmlAttributeEscapes: Readonly<Record<string, string>> = Object.freeze({
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&apos;",
});

/**
 * Characters that must be escaped inside XML text content.
 */
const XmlTextEscapes: Readonly<Record<string, string>> = Object.freeze({
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
});

/**
 * Escapes a value for safe inclusion inside an XML attribute value.
 * Non-string values are coerced via `String()`.
 */
export function escapeXmlAttribute(value: string | number | boolean | null | undefined): string {
  if (value === null || value === undefined) {
    return "";
  }
  const text = typeof value === "string" ? value : String(value);
  return text.replace(/[&<>"']/g, (char) => XmlAttributeEscapes[char] ?? char);
}

/**
 * Escapes a value for safe inclusion inside XML element text content.
 * Accepts the same value types as {@link escapeXmlAttribute} for consistency.
 */
export function escapeXmlText(value: string | number | boolean | null | undefined): string {
  if (value === null || value === undefined) {
    return "";
  }
  const text = typeof value === "string" ? value : String(value);
  return text.replace(/[&<>]/g, (char) => XmlTextEscapes[char] ?? char);
}

/**
 * A single XML attribute, expressed as a name-value pair.
 * Values of `null` or `undefined` cause the attribute to be omitted.
 */
export type XmlAttribute = readonly [name: string, value: string | number | boolean | null | undefined];

/**
 * Serialises a single attribute into `name="value"` form, or returns an empty
 * string when the value is absent.
 */
export function formatXmlAttribute(attribute: XmlAttribute): string {
  const [name, rawValue] = attribute;
  if (rawValue === null || rawValue === undefined || rawValue === "") {
    return "";
  }
  const escaped = escapeXmlAttribute(rawValue);
  return `${name}="${escaped}"`;
}

/**
 * Serialises a list of attributes into a space-separated string suitable for
 * placement inside an opening tag. Absent values are silently dropped.
 */
export function formatXmlAttributes(attributes: readonly XmlAttribute[]): string {
  return attributes
    .map(formatXmlAttribute)
    .filter((segment) => segment.length > 0)
    .join(" ");
}

/**
 * Builds a full opening tag: `<tag attr1="v1" attr2="v2">`.
 * When no attributes are present, returns `<tag>`.
 */
export function formatXmlOpenTag(tag: string, attributes: readonly XmlAttribute[] = []): string {
  const attrs = formatXmlAttributes(attributes);
  return attrs.length > 0 ? `<${tag} ${attrs}>` : `<${tag}>`;
}

/**
 * Builds a closing tag: `</tag>`.
 */
export function formatXmlCloseTag(tag: string): string {
  return `</${tag}>`;
}

/**
 * Builds a self-closing tag: `<tag attr1="v1" />`.
 * When no attributes are present, returns `<tag />`.
 */
export function formatSelfClosingXmlBlock(tag: string, attributes: readonly XmlAttribute[] = []): string {
  const attrs = formatXmlAttributes(attributes);
  return attrs.length > 0 ? `<${tag} ${attrs} />` : `<${tag} />`;
}

/**
 * Builds a complete XML block with opening tag, indented content, and closing
 * tag. When `content` is empty, a self-closing tag is emitted instead.
 *
 * @param tag - The element name.
 * @param attributes - Attribute name-value pairs.
 * @param content - Inner text content (will be XML-escaped).
 */
export function formatXmlBlock(tag: string, attributes: readonly XmlAttribute[], content: string): string {
  const trimmed = content.trim();
  if (trimmed.length === 0) {
    return formatSelfClosingXmlBlock(tag, attributes);
  }
  const open = formatXmlOpenTag(tag, attributes);
  const close = formatXmlCloseTag(tag);
  return `${open}\n${escapeXmlText(trimmed)}\n${close}`;
}

/**
 * Builds a complete XML block whose content is already pre-formatted (e.g.
 * JSON arguments) and should NOT be XML-escaped again. This is useful for
 * tool-call arguments where the content is a JSON string that the model needs
 * to read verbatim.
 *
 * @param tag - The element name.
 * @param attributes - Attribute name-value pairs.
 * @param rawContent - Inner content that will be emitted without escaping.
 */
export function formatXmlBlockRaw(tag: string, attributes: readonly XmlAttribute[], rawContent: string): string {
  const trimmed = rawContent.trim();
  if (trimmed.length === 0) {
    return formatSelfClosingXmlBlock(tag, attributes);
  }
  const open = formatXmlOpenTag(tag, attributes);
  const close = formatXmlCloseTag(tag);
  return `${open}\n${trimmed}\n${close}`;
}
