/**
 * Re-export of the shared XML formatting primitives.
 *
 * The canonical implementation lives in {@link ../Xml/AgentXmlFormat.ts} so
 * that both the ActionPlanner layer and the Pi layer share a single source
 * of truth for XML escaping rules. This re-export preserves backward
 * compatibility for existing ActionPlanner imports.
 *
 * @see Xml/AgentXmlFormat.ts for the implementation.
 */
export {
  escapeXmlAttribute,
  escapeXmlText,
  formatXmlAttribute,
  formatXmlAttributes,
  formatXmlOpenTag,
  formatXmlCloseTag,
  formatSelfClosingXmlBlock,
  formatXmlBlock,
  type XmlAttribute,
} from "../Xml/AgentXmlFormat.js";
