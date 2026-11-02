/** One descriptor owns the independently built, optional QQ client. */
export const AgentQqClientBuild = {
  id: "senera-qq",
  name: "Senera QQ",
  outputDirectory: "Frontend/.cache/client-builds/senera-qq",
  entryDocument: "qq/index.html",
  integrityFile: "qq/source-integrity.json",
  artifactPrefix: "SeneraQQ",
} as const;
