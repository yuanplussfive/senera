export interface SeneraProcessEnvironmentPolicyOptions {
  readonly Inherit?: "all" | "allowlist" | "none";
  readonly IncludeOnly?: readonly string[];
  readonly Exclude?: readonly string[];
  readonly Set?: Readonly<Record<string, string>>;
}

export const SeneraDefaultProcessEnvironmentIncludeOnly = [
  "PATH",
  "HOME",
  "USER",
  "USERNAME",
  "USERPROFILE",
  "TMP",
  "TEMP",
  "TMPDIR",
  "SystemRoot",
  "ComSpec",
  "PATHEXT",
  "PWD",
  "TERM",
  "TERM_PROGRAM",
  "LANG",
  "LC_*",
  "CI",
] as const;

export class SeneraProcessEnvironmentPolicy {
  private readonly inherit: "all" | "allowlist" | "none";
  private readonly includeOnly: readonly string[];
  private readonly exclude: ReadonlySet<string>;
  private readonly set: Readonly<Record<string, string>>;

  constructor(options: SeneraProcessEnvironmentPolicyOptions = {}) {
    this.inherit = options.Inherit ?? "allowlist";
    const includeOnly = options.IncludeOnly ?? SeneraDefaultProcessEnvironmentIncludeOnly;
    this.includeOnly = [...normalizedNames(includeOnly)];
    this.exclude = normalizedNames(options.Exclude);
    this.set = { ...(options.Set ?? {}) };
  }

  project(base: NodeJS.ProcessEnv, overrides?: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
    const inherited =
      this.inherit === "none"
        ? {}
        : filterEnvironment(base, (name) =>
            this.includeOnly.length > 0
              ? this.includeOnly.some((entry) => matchesName(entry, name)) && !this.exclude.has(name)
              : !this.exclude.has(name),
          );
    const explicit = filterEnvironment(overrides ?? {}, (name) => !this.exclude.has(name));
    return { ...inherited, ...explicit, ...this.set };
  }
}

function filterEnvironment(
  environment: NodeJS.ProcessEnv,
  include: (normalizedName: string) => boolean,
): NodeJS.ProcessEnv {
  return Object.fromEntries(
    Object.entries(environment).filter(([name, value]) => typeof value === "string" && include(normalizeName(name))),
  );
}

function normalizedNames(values: readonly string[] | undefined): ReadonlySet<string> {
  return new Set((values ?? []).map(normalizeName));
}

function normalizeName(value: string): string {
  return process.platform === "win32" ? value.toUpperCase() : value;
}

function matchesName(pattern: string, name: string): boolean {
  return pattern.endsWith("*") ? name.startsWith(pattern.slice(0, -1)) : pattern === name;
}
