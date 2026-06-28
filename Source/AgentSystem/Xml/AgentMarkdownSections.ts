export interface AgentMarkdownDocument {
  title?: string;
  sections: Map<string, string>;
}

export function parseMarkdownSections(content: string): AgentMarkdownDocument {
  const lines = content.split(/\r?\n/);
  const sections = new Map<string, string>();
  let title: string | undefined;
  let currentSection: string | undefined;
  let buffer: string[] = [];

  const flush = (): void => {
    if (!currentSection) {
      return;
    }

    sections.set(currentSection, buffer.join("\n").trim());
    buffer = [];
  };

  for (const line of lines) {
    const titleMatch = /^#\s+(.+?)\s*$/.exec(line);
    if (titleMatch && !title) {
      title = titleMatch[1];
      continue;
    }

    const sectionMatch = /^##\s+(.+?)\s*$/.exec(line);
    if (sectionMatch) {
      flush();
      currentSection = sectionMatch[1];
      continue;
    }

    if (currentSection) {
      buffer.push(line);
    }
  }

  flush();

  return {
    title,
    sections,
  };
}

export function normalizeMarkdownSectionText(value: string | undefined): string {
  return (value ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .join(" ");
}
