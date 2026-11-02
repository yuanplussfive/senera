import chalk from "chalk";

export const AgentConsoleTheme = {
  brand: chalk.hex("#7dd3fc"),
  accent: chalk.hex("#a7f3d0"),
  action: chalk.hex("#c4b5fd"),
  tool: chalk.hex("#f9a8d4"),
  xml: chalk.hex("#93c5fd"),
  retry: chalk.hex("#fbbf24"),
  success: chalk.hex("#34d399"),
  warning: chalk.hex("#f59e0b"),
  error: chalk.hex("#fb7185"),
  muted: chalk.hex("#94a3b8"),
  dim: chalk.dim,
  label: chalk.hex("#e5e7eb"),
  value: chalk.hex("#f8fafc"),
  frame: chalk.hex("#bae6fd"),
  code: chalk.hex("#d9f99d"),
};

export function colorByEventType(type: string): (value: string) => string {
  const groups: Array<[RegExp, (value: string) => string]> = [
    [/^model\./, AgentConsoleTheme.accent],
    [/^decision\./, AgentConsoleTheme.action],
    [/^tool\./, AgentConsoleTheme.tool],
    [/^retry\./, AgentConsoleTheme.retry],
    [/^final\./, AgentConsoleTheme.success],
    [/^ask\./, AgentConsoleTheme.warning],
    [/(^run\.failed$|^request\.invalid$|^config\.failed$|error$)/, AgentConsoleTheme.error],
    [/^config\./, AgentConsoleTheme.brand],
  ];

  return groups.find(([pattern]) => pattern.test(type))?.[1] ?? AgentConsoleTheme.brand;
}
