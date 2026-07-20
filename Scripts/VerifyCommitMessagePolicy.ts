import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";

const workspaceRoot = process.cwd();
const require = createRequire(import.meta.url);
const commitlintCliPath = require.resolve("@commitlint/cli/cli.js");
const autofixMessage = [
  "Potential fix for pull request finding 'CodeQL / Shell command built from environment values'",
  "",
  "Co-authored-by: Copilot Autofix powered by AI <62310815+github-advanced-security[bot]@users.noreply.github.com>",
].join("\n");

assertCommitlintResult(autofixMessage, true);
assertCommitlintResult(autofixMessage.replaceAll("\n", "\r\n"), true);
assertCommitlintResult("fix: preserve conventional commit validation", true);
assertCommitlintResult(autofixMessage.split("\n")[0] ?? "", false);
assertCommitlintResult(
  [
    "Potential fix supplied manually",
    "",
    "Co-authored-by: Copilot Autofix powered by AI <62310815+github-advanced-security[bot]@users.noreply.github.com>",
  ].join("\n"),
  false,
);

console.log("Commit message policy verification passed.");

function assertCommitlintResult(message: string, expectedValid: boolean): void {
  const result = spawnSync(process.execPath, [commitlintCliPath], {
    cwd: workspaceRoot,
    encoding: "utf8",
    input: `${message}\n`,
    windowsHide: true,
  });
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  assert.equal(
    result.status === 0,
    expectedValid,
    `Unexpected commitlint result for ${JSON.stringify(message)}:\n${output}`,
  );
}
