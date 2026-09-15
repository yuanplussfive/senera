import { SeneraExecutionError, SeneraExecutionErrorCodes } from "./SeneraExecutionTypes.js";
import type { SeneraTerminalBackend, SeneraTerminalBoundary, SeneraTerminalCapability } from "./SeneraTerminalTypes.js";
import type { SeneraShellDialect } from "./SeneraShellCommand.js";

export interface SeneraTerminalBackendSelection {
  readonly boundary: SeneraTerminalBoundary;
  readonly requiredCapabilities?: readonly SeneraTerminalCapability[];
  readonly shellDialect?: SeneraShellDialect;
}

export class SeneraTerminalBackendRegistry {
  private readonly backendsByBoundary = new Map<SeneraTerminalBoundary, SeneraTerminalBackend[]>();

  constructor(backends: Iterable<SeneraTerminalBackend> = []) {
    for (const backend of backends) this.register(backend);
  }

  register(backend: SeneraTerminalBackend): void {
    const existing = this.backendsByBoundary.get(backend.descriptor.boundary) ?? [];
    if (existing.some((candidate) => candidate.descriptor.id === backend.descriptor.id)) {
      throw new Error(`Terminal backend ${backend.descriptor.id} is already registered.`);
    }
    this.backendsByBoundary.set(backend.descriptor.boundary, [...existing, backend]);
  }

  resolve(selection: SeneraTerminalBackendSelection): SeneraTerminalBackend {
    const required = new Set(selection.requiredCapabilities ?? []);
    const candidates = this.backendsByBoundary.get(selection.boundary) ?? [];
    const capable = candidates.filter((candidate) =>
      [...required].every((capability) => candidate.descriptor.capabilities.has(capability)),
    );
    const backend = capable.find(
      (candidate) => !selection.shellDialect || candidate.descriptor.shellDialect === selection.shellDialect,
    );
    if (backend) return backend;

    throw new SeneraExecutionError(
      selection.boundary === "sandbox"
        ? SeneraExecutionErrorCodes.SandboxUnavailable
        : SeneraExecutionErrorCodes.SpawnFailed,
      `No terminal backend satisfies the ${selection.boundary} execution boundary.`,
      {
        reason:
          candidates.length === 0
            ? "backend_unavailable"
            : capable.length === 0
              ? "terminal_capability_unsupported"
              : "shell_dialect_unsupported",
        boundary: selection.boundary,
        requiredCapabilities: [...required],
        requestedShellDialect: selection.shellDialect,
        availableBackends: candidates.map(({ descriptor }) => ({
          id: descriptor.id,
          shellDialect: descriptor.shellDialect,
          capabilities: [...descriptor.capabilities],
        })),
      },
    );
  }
}
