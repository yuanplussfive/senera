/** Encodes a host-generated assistant delivery as the durable conversation XML shape. */
export function projectAssistantDeliveryXml(content: string): string {
  return `<response><answer>${escapeXmlText(content)}</answer></response>`;
}

function escapeXmlText(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}
