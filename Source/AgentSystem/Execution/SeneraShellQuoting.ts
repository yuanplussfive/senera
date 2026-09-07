export function quoteShellArguments(args: readonly string[]): string {
  return args.map(quoteShellArgument).join(" ");
}

function quoteShellArgument(value: string): string {
  return value.length === 0 || /[\s"'`$\\|&;<>()[\]{}!*?]/u.test(value) ? `'${value.replace(/'/gu, "'\\''")}'` : value;
}
