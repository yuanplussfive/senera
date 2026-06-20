export class AgentToolSearchTokenizer {
  private readonly stopWords = new Set([
    "a",
    "an",
    "and",
    "are",
    "as",
    "by",
    "for",
    "from",
    "in",
    "is",
    "of",
    "on",
    "or",
    "the",
    "to",
    "with",
    "不",
    "个",
    "了",
    "和",
    "哪些",
    "请",
    "或",
    "是",
    "什么",
    "用",
    "的",
    "怎么",
    "如何",
    "要",
    "不要",
    "看看",
    "我们",
    "我们的",
  ]);
  private readonly segmenter = typeof Intl.Segmenter === "function"
    ? new Intl.Segmenter(["zh", "en"], { granularity: "word" })
    : undefined;

  tokenize(text: string): string[] {
    const normalized = this.normalize(text);
    const segmented = this.segment(normalized);
    const expanded = segmented.flatMap((token) => this.expandToken(token));
    return [...new Set(expanded.filter((token) => this.isUsefulToken(token)))];
  }

  private normalize(text: string): string {
    return text
      .normalize("NFKC")
      .replace(/([a-z\d])([A-Z][a-z])/g, "$1 $2")
      .replace(/[_\-./\\:]+/g, " ")
      .toLowerCase();
  }

  private segment(text: string): string[] {
    if (!this.segmenter) {
      return this.splitByBoundary(text);
    }

    return [...this.segmenter.segment(text)]
      .map((entry) => entry.segment.trim())
      .filter((token) => token.length > 0 && !this.isSeparator(token))
      .flatMap((token) => this.splitByBoundary(token));
  }

  private splitByBoundary(text: string): string[] {
    return text
      .split(/[^\p{L}\p{N}]+/u)
      .map((token) => token.trim())
      .filter(Boolean);
  }

  private expandToken(token: string): string[] {
    return token.length > 2 && /[\p{Script=Han}]/u.test(token)
      ? [token, ...this.characterBigrams(token)]
      : [token];
  }

  private isUsefulToken(token: string): boolean {
    return token.length > 0
      && !this.stopWords.has(token)
      && !/^[\p{Script=Han}]$/u.test(token);
  }

  private characterBigrams(token: string): string[] {
    const chars = [...token];
    return chars.length < 2
      ? []
      : chars.slice(0, -1).map((char, index) => `${char}${chars[index + 1]}`);
  }

  private isSeparator(token: string): boolean {
    return /^[\s\p{P}\p{S}]+$/u.test(token);
  }
}
