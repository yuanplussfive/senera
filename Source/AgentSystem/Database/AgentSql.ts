export function agentSql(strings: TemplateStringsArray, ...values: readonly never[]): string {
  if (values.length > 0) {
    throw new TypeError("SQL templates do not accept interpolated values; use bound parameters.");
  }
  return strings.join("");
}
