import { parse as parseHtml, type DefaultTreeAdapterMap } from "parse5";
import { init, parse as parseModule } from "es-module-lexer";

/**
 * Vite modules are proxied at the authenticated document's origin. HTML base
 * URLs do not apply to inline module imports, so resolve their paths with the
 * module lexer and keep the public origin instead of exposing Vite's loopback URL.
 */
export async function resolveAgentDevelopmentClientDocument(html: string, entry: URL): Promise<string> {
  await init;
  const edits: Array<{ start: number; end: number; text: string }> = [];
  function visit(node: DefaultTreeAdapterMap["node"]): void {
    if (
      "tagName" in node &&
      node.tagName === "script" &&
      node.attrs.some((attr) => attr.name === "type" && attr.value === "module")
    ) {
      for (const child of node.childNodes) {
        if (child.nodeName !== "#text" || !("value" in child) || !child.sourceCodeLocation) continue;
        const [imports] = parseModule(child.value);
        for (const specifier of imports) {
          if (!specifier.n?.startsWith(".") && !specifier.n?.startsWith("/")) continue;
          const resolved = new URL(specifier.n, entry);
          const absolute = `${resolved.pathname}${resolved.search}${resolved.hash}`;
          edits.push({
            start: child.sourceCodeLocation.startOffset + specifier.s,
            end: child.sourceCodeLocation.startOffset + specifier.e,
            text: specifier.d >= 0 ? JSON.stringify(absolute) : absolute,
          });
        }
      }
    }
    if ("childNodes" in node) for (const child of node.childNodes) visit(child);
  }
  visit(parseHtml(html, { sourceCodeLocationInfo: true }));
  for (const edit of edits.sort((left, right) => right.start - left.start)) {
    html = html.slice(0, edit.start) + edit.text + html.slice(edit.end);
  }
  return html;
}
