import { Jieba, TfIdf } from "@node-rs/jieba";
import { dict, idf } from "@node-rs/jieba/dict";

const SearchCharacterPattern = /[\p{L}\p{N}]/u;

export class AgentToolSearchTokenizer {
  private readonly segmenter = Jieba.withDict(dict);
  private readonly keywordExtractor = TfIdf.withDict(idf);

  tokenize(text: string): string[] {
    const normalized = this.normalize(text);
    const tokens = this.segmenter.cutForSearch(normalized, true)
      .map((token) => this.normalizeToken(token))
      .filter((token) => SearchCharacterPattern.test(token));
    return [...new Set(tokens)];
  }

  keywords(text: string): string[] {
    const normalized = this.normalize(text);
    const tokenLimit = this.tokenize(normalized).length;
    if (tokenLimit === 0) {
      return [];
    }

    const keywords = this.keywordExtractor.extractKeywords(
      this.segmenter,
      normalized,
      tokenLimit,
    ).map((entry) => this.normalizeToken(entry.keyword))
      .filter((token) => SearchCharacterPattern.test(token));
    return [...new Set(keywords)];
  }

  private normalize(text: string): string {
    return text.normalize("NFKC").toLocaleLowerCase();
  }

  private normalizeToken(token: string): string {
    return token.trim().toLocaleLowerCase();
  }
}
