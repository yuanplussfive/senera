const GitHubAdvancedSecurityAutofixHeader = /^Potential fix for pull request finding '.+'$/u;
const GitHubAdvancedSecurityAutofixCoauthor =
  "Co-authored-by: Copilot Autofix powered by AI <62310815+github-advanced-security[bot]@users.noreply.github.com>";
const CommitMessageLineBreak = /\r?\n/u;
const Url = /\bhttps?:\/\/\S+/u;

export function isGitHubAdvancedSecurityAutofixCommit(message) {
  const lines = message.trimEnd().split(CommitMessageLineBreak);
  return (
    lines.length === 3 &&
    GitHubAdvancedSecurityAutofixHeader.test(lines[0] ?? "") &&
    lines[1] === "" &&
    lines[2] === GitHubAdvancedSecurityAutofixCoauthor
  );
}

export function footerMaxLineLengthWithGitHubAutofixCoauthor(parsed, when = "always", maxLength = 0) {
  if (!parsed.footer) {
    return [true];
  }

  const hasValidLineLengths = parsed.footer.split(CommitMessageLineBreak).every((line) => {
    return line === GitHubAdvancedSecurityAutofixCoauthor || Url.test(line) || line.length <= maxLength;
  });
  const valid = when === "never" ? !hasValidLineLengths : hasValidLineLengths;
  return [valid, `footer's lines must not be longer than ${maxLength} characters`];
}

export default {
  extends: ["@commitlint/config-conventional"],
  ignores: [isGitHubAdvancedSecurityAutofixCommit],
  plugins: [
    {
      rules: {
        "footer-max-line-length": footerMaxLineLengthWithGitHubAutofixCoauthor,
      },
    },
  ],
  rules: {
    "header-max-length": [2, "always", 100],
  },
};
