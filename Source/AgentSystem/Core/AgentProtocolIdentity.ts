export type SeneraProtocolType<Name extends string, Version extends number> = `senera.${Name}.v${Version}`;

export interface SeneraProtocolIdentity<Name extends string, Version extends number> {
  readonly name: Name;
  readonly version: Version;
  readonly type: SeneraProtocolType<Name, Version>;
}

const SeneraProtocolNamespace = "senera";
const SeneraProtocolVersionPrefix = "v";

export function defineSeneraProtocol<const Name extends string, const Version extends number>(
  name: Name,
  version: Version,
): Readonly<SeneraProtocolIdentity<Name, Version>> {
  const type = `${SeneraProtocolNamespace}.${name}.${SeneraProtocolVersionPrefix}${version}` as SeneraProtocolType<
    Name,
    Version
  >;
  if (!isSeneraProtocolType(type)) {
    throw new RangeError(`Invalid Senera protocol identity: ${type}`);
  }
  return Object.freeze({
    name,
    version,
    type,
  });
}

export function isSeneraProtocolType(value: string): value is SeneraProtocolType<string, number> {
  const [namespace, name, versionSegment, ...remainder] = value.split(".");
  const versionText = versionSegment?.startsWith(SeneraProtocolVersionPrefix)
    ? versionSegment.slice(SeneraProtocolVersionPrefix.length)
    : "";
  const version = Number(versionText);
  return (
    namespace === SeneraProtocolNamespace &&
    Boolean(name) &&
    remainder.length === 0 &&
    Number.isSafeInteger(version) &&
    version > 0 &&
    String(version) === versionText
  );
}
