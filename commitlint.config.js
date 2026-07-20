const GitHubAdvancedSecurityAutofixHeader = /^Potential fix for pull request finding '.+'$/u;
const GitHubAdvancedSecurityAutofixCoauthor =
  "Co-authored-by: Copilot Autofix powered by AI <62310815+github-advanced-security[bot]@users.noreply.github.com>";

export function isGitHubAdvancedSecurityAutofixCommit(message) {
  const lines = message.trimEnd().split(/\r?\n/u);
  return (
    lines.length === 3 &&
    GitHubAdvancedSecurityAutofixHeader.test(lines[0] ?? "") &&
    lines[1] === "" &&
    lines[2] === GitHubAdvancedSecurityAutofixCoauthor
  );
}

export default {
  extends: ["@commitlint/config-conventional"],
  ignores: [isGitHubAdvancedSecurityAutofixCommit],
  rules: {
    "header-max-length": [2, "always", 100],
  },
};
