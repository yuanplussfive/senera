import { readFileSync } from "node:fs";

/**
 * Retrieval word lists are curated as plain text next to this module so the
 * same resources ship with the runtime and stay reviewable outside the code.
 * `Lexicon/sources.json` records the provenance, license and digest of every
 * file, so word-list changes stay data edits.
 */
const StopwordResourceFiles = ["en-core.txt", "en-extended.txt", "zh-core.txt", "zh-extended.txt"] as const;
const StopwordResourceDirectory = new URL("./Lexicon/stopwords/", import.meta.url);

function readStopwordResource(fileName: string): string[] {
  return readFileSync(new URL(fileName, StopwordResourceDirectory), "utf8")
    .split(/\r?\n/u)
    .map((line) => line.trim().toLocaleLowerCase())
    .filter(Boolean);
}

/**
 * Function words shared by every retrieval view. Negation and the Chinese
 * existential verb 有 are deliberately absent: dropping them would turn a
 * fact into its own opposite.
 */
export const AgentToolSearchStopwords: ReadonlySet<string> = new Set(
  StopwordResourceFiles.flatMap((fileName) => readStopwordResource(fileName)),
);
