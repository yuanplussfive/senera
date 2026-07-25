export interface AgentDockerImageSummary {
  Id?: string;
  RepoTags?: string[];
  RepoDigests?: string[];
}

export interface AgentDockerImageLoadResolutionInput {
  imagesBefore: readonly AgentDockerImageSummary[];
  imagesAfter: readonly AgentDockerImageSummary[];
  loadEvents: readonly unknown[];
  expectedImageIds: readonly string[];
  expectedReferences: readonly string[];
}

/** Resolves exactly one image from Docker's load result and post-load inventory. */
export function resolveAgentDockerLoadedImageId(input: AgentDockerImageLoadResolutionInput): string {
  const beforeIds = dockerImageIds(input.imagesBefore);
  const afterIds = dockerImageIds(input.imagesAfter);
  const identifiedIds = new Set<string>();

  for (const expectedId of input.expectedImageIds.map(normalizeDockerImageId)) {
    if (afterIds.has(expectedId)) identifiedIds.add(expectedId);
  }
  addSetValues(identifiedIds, findDockerImageIdsByReferences(input.imagesAfter, input.expectedReferences));

  const loadIdentity = readDockerImageLoadIdentity(input.loadEvents);
  for (const imageId of loadIdentity.imageIds) {
    if (!afterIds.has(imageId)) {
      throw new Error(`Docker reported loaded image ${imageId}, but it is absent from the post-import inventory.`);
    }
    identifiedIds.add(imageId);
  }
  addSetValues(identifiedIds, findDockerImageIdsByReferences(input.imagesAfter, [...loadIdentity.references]));

  if (identifiedIds.size === 1) return firstSetValue(identifiedIds);
  if (identifiedIds.size > 1) {
    throw new Error(
      `Verified Sandbox Bundle load identified multiple images: ${[...identifiedIds].sort().join(", ")}.`,
    );
  }

  const addedIds = new Set([...afterIds].filter((imageId) => !beforeIds.has(imageId)));
  if (addedIds.size === 1) return firstSetValue(addedIds);
  throw new Error(
    addedIds.size === 0
      ? "Verified Sandbox Bundle was loaded, but Docker did not expose its image identity."
      : `Verified Sandbox Bundle load added multiple images: ${[...addedIds].sort().join(", ")}.`,
  );
}

function dockerImageIds(images: readonly AgentDockerImageSummary[]): Set<string> {
  return new Set(images.flatMap((image) => (image.Id ? [normalizeDockerImageId(image.Id)] : [])));
}

function findDockerImageIdsByReferences(
  images: readonly AgentDockerImageSummary[],
  references: readonly string[],
): Set<string> {
  const expected = new Set(references.map(normalizeDockerImageReference));
  return new Set(
    images.flatMap((image) => {
      if (!image.Id) return [];
      const matches = [...(image.RepoTags ?? []), ...(image.RepoDigests ?? [])].some((reference) =>
        expected.has(normalizeDockerImageReference(reference)),
      );
      return matches ? [normalizeDockerImageId(image.Id)] : [];
    }),
  );
}

function readDockerImageLoadIdentity(events: readonly unknown[]): {
  imageIds: ReadonlySet<string>;
  references: ReadonlySet<string>;
} {
  const imageIds = new Set<string>();
  const references = new Set<string>();
  for (const event of events) {
    if (!isRecord(event)) continue;
    for (const value of [event.stream, event.status]) {
      if (typeof value !== "string") continue;
      for (const line of value.split(/\r?\n/u)) {
        const imageId = /^Loaded image ID:\s*(sha256:[a-f0-9]{64})\s*$/iu.exec(line)?.[1];
        if (imageId) {
          imageIds.add(normalizeDockerImageId(imageId));
          continue;
        }
        const reference = /^Loaded image:\s*(\S+)\s*$/u.exec(line)?.[1];
        if (reference) references.add(reference);
      }
    }
  }
  return { imageIds, references };
}

function normalizeDockerImageId(value: string): string {
  return value.trim().toLowerCase();
}

function normalizeDockerImageReference(reference: string): string {
  const trimmed = reference.trim();
  const digestSeparator = trimmed.indexOf("@");
  const name = digestSeparator >= 0 ? trimmed.slice(0, digestSeparator) : imageNameWithoutTag(trimmed);
  const suffix = digestSeparator >= 0 ? trimmed.slice(digestSeparator) : trimmed.slice(name.length);
  const segments = name.split("/");
  const registry = segments[0] ?? "";
  const hasExplicitRegistry = registry === "localhost" || registry.includes(".") || registry.includes(":");
  const normalizedName = hasExplicitRegistry
    ? `${registry === "index.docker.io" ? "docker.io" : registry}/${segments.slice(1).join("/")}`
    : segments.length === 1
      ? `docker.io/library/${name}`
      : `docker.io/${name}`;
  return `${normalizedName}${suffix}`;
}

function imageNameWithoutTag(reference: string): string {
  const separator = reference.lastIndexOf(":");
  return separator > reference.lastIndexOf("/") ? reference.slice(0, separator) : reference;
}

function addSetValues(target: Set<string>, values: ReadonlySet<string>): void {
  for (const value of values) target.add(value);
}

function firstSetValue(values: ReadonlySet<string>): string {
  const value = values.values().next().value;
  if (typeof value !== "string") throw new Error("Expected a non-empty Docker image identity set.");
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
