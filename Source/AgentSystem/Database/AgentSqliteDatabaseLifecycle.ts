import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const MarkerSuffix = ".senera-sqlite-open-";
const MarkerExtension = ".json";
const ProcessInstanceId = randomUUID();
const activeLeases = new Map<string, ActiveDatabaseLease>();

interface ActiveDatabaseLease {
  readonly databasePath: string;
  readonly markerPath?: string;
  readonly lifecycleEvidenceAvailable: boolean;
  references: number;
  abandoned: boolean;
}

export interface AgentSqliteDatabaseLifecycleLease {
  /** A prior process did not record a clean close, so this open must verify physical integrity. */
  readonly requiresIntegrityCheck: boolean;
  /** Clears markers left by dead processes only after this open has established a healthy database. */
  confirmIntegrity(): void;
  /** Releases this kernel's lease after the connection closed cleanly. */
  closeCleanly(): void;
  /** Keeps the lease durable when initialization or shutdown did not complete. */
  abandon(): void;
}

export interface AgentSqliteDatabaseFamilyPathOptions {
  /**
   * A kernel that is already open must retain its own durable lease marker while it replaces
   * database files. Administrative cleanup and upgrade operations leave this unset and receive
   * the complete database family.
   */
  readonly excludeCurrentProcessMarkers?: boolean;
}

/**
 * Durable process leases distinguish a normal SQLite restart from one following interruption. The
 * marker exists before SQLite can mutate state and disappears only after its last in-process owner
 * closes cleanly, so recovery work is driven by lifecycle evidence rather than time or size guesses.
 */
export function acquireAgentSqliteDatabaseLifecycle(databasePath: string): AgentSqliteDatabaseLifecycleLease {
  const normalizedPath = path.resolve(databasePath);
  const existing = activeLeases.get(normalizedPath);
  if (existing) {
    existing.references += 1;
    return createLease(existing, false, []);
  }

  // A marker is recovery evidence, not a prerequisite for opening the database. If its directory
  // cannot be inspected or a marker cannot be persisted, retain the safe pre-marker behavior and
  // make this open verify integrity instead of converting filesystem housekeeping into startup failure.
  const markerSnapshot = inspectOpenMarkers(normalizedPath);
  const markerPath = createMarker(normalizedPath);
  const state: ActiveDatabaseLease = {
    databasePath: normalizedPath,
    markerPath,
    lifecycleEvidenceAvailable: markerSnapshot.available && markerPath !== undefined,
    references: 1,
    abandoned: false,
  };
  activeLeases.set(normalizedPath, state);
  return createLease(
    state,
    !state.lifecycleEvidenceAvailable || markerSnapshot.markers.length > 0,
    state.lifecycleEvidenceAvailable ? markerSnapshot.markers : [],
  );
}

function createLease(
  state: ActiveDatabaseLease,
  requiresIntegrityCheck: boolean,
  staleMarkerPaths: readonly string[],
): AgentSqliteDatabaseLifecycleLease {
  let released = false;
  const release = (clean: boolean): void => {
    if (released) return;
    released = true;
    if (!clean) state.abandoned = true;
    state.references -= 1;
    if (state.references > 0) return;
    activeLeases.delete(state.databasePath);
    if (state.abandoned) return;
    if (state.markerPath) removeMarker(state.markerPath);
  };
  return {
    requiresIntegrityCheck,
    confirmIntegrity: () => {
      if (!state.lifecycleEvidenceAvailable) return;
      for (const markerPath of staleMarkerPaths) removeMarker(markerPath);
    },
    closeCleanly: () => release(true),
    abandon: () => release(false),
  };
}

function createMarker(databasePath: string): string | undefined {
  const markerPath = `${databasePath}${MarkerSuffix}${ProcessInstanceId}${MarkerExtension}`;
  try {
    fs.writeFileSync(markerPath, `${JSON.stringify({ owner: ProcessInstanceId })}\n`, {
      encoding: "utf8",
      flag: "wx",
      mode: 0o600,
    });
    return markerPath;
  } catch {
    return undefined;
  }
}

function inspectOpenMarkers(databasePath: string): {
  readonly available: boolean;
  readonly markers: readonly string[];
} {
  const directory = path.dirname(databasePath);
  const prefix = `${path.basename(databasePath)}${MarkerSuffix}`;
  try {
    return {
      available: true,
      markers: fs
        .readdirSync(directory, { withFileTypes: true })
        .filter((entry) => entry.isFile() && entry.name.startsWith(prefix) && entry.name.endsWith(MarkerExtension))
        .map((entry) => path.join(directory, entry.name)),
    };
  } catch (error) {
    return { available: isMissingDirectoryError(error), markers: [] };
  }
}

function removeMarker(markerPath: string): void {
  try {
    fs.unlinkSync(markerPath);
  } catch (error) {
    // Lifecycle evidence is advisory during close. A later open treats any retained marker as recovery evidence.
    void error;
  }
}

/** Includes durable recovery markers so administrative lifecycle operations do not orphan them. */
export function listAgentSqliteDatabaseFamilyPaths(
  databasePath: string,
  options: AgentSqliteDatabaseFamilyPathOptions = {},
): readonly string[] {
  const normalizedPath = path.resolve(databasePath);
  const markers = inspectOpenMarkers(normalizedPath).markers.filter(
    (markerPath) => !options.excludeCurrentProcessMarkers || !isCurrentProcessMarker(markerPath),
  );
  return [normalizedPath, `${normalizedPath}-wal`, `${normalizedPath}-shm`, ...markers];
}

function isCurrentProcessMarker(markerPath: string): boolean {
  return markerPath.endsWith(`${MarkerSuffix}${ProcessInstanceId}${MarkerExtension}`);
}

function isMissingDirectoryError(error: unknown): boolean {
  return error instanceof Error && "code" in error && (error as NodeJS.ErrnoException).code === "ENOENT";
}
