import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";

const title = process.env.GITHUB_PR_TITLE;
if (!title?.trim()) {
  throw new Error("GITHUB_PR_TITLE must contain the pull request title.");
}
if (/\r|\n/u.test(title)) {
  throw new Error("Pull request titles must be a single Conventional Commit header.");
}

const require = createRequire(import.meta.url);
const commitlintCliPath = require.resolve("@commitlint/cli/cli.js");
const result = spawnSync(process.execPath, [commitlintCliPath], {
  cwd: process.cwd(),
  encoding: "utf8",
  input: `${title}\n`,
  windowsHide: true,
});

if (result.error) {
  throw result.error;
}
if (result.status !== 0) {
  const output = `${result.stdout ?? ""}${result.stderr ?? ""}`.trim();
  throw new Error(`Pull request title must follow Conventional Commits.\n${output}`);
}

console.log("Pull request title follows Conventional Commits.");
