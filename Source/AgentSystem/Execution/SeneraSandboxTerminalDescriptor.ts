import { SeneraShellDialects } from "./SeneraShellCommand.js";
import {
  SeneraTerminalCapabilityNames,
  SeneraTerminalCapabilityProviders,
  SeneraTerminalPersistenceScopes,
  type SeneraTerminalBackendDescriptor,
  type SeneraTerminalCapabilityProvider,
  type SeneraTerminalExecutionMetadata,
} from "./SeneraTerminalTypes.js";

export function createSeneraSandboxTerminalDescriptor(
  id: string,
  signalProvider: SeneraTerminalCapabilityProvider,
): SeneraTerminalBackendDescriptor {
  return {
    id,
    boundary: "sandbox",
    shellDialect: SeneraShellDialects.Posix,
    capabilities: new Set([
      SeneraTerminalCapabilityNames.Persistent,
      SeneraTerminalCapabilityNames.InteractiveInput,
      SeneraTerminalCapabilityNames.Resize,
      SeneraTerminalCapabilityNames.Signals,
    ]),
    capabilityProviders: {
      [SeneraTerminalCapabilityNames.Persistent]: SeneraTerminalCapabilityProviders.GuestNodePty,
      [SeneraTerminalCapabilityNames.InteractiveInput]: SeneraTerminalCapabilityProviders.GuestNodePty,
      [SeneraTerminalCapabilityNames.Resize]: SeneraTerminalCapabilityProviders.GuestNodePty,
      [SeneraTerminalCapabilityNames.Signals]: signalProvider,
    },
    persistenceScope: SeneraTerminalPersistenceScopes.ExecutionResource,
  };
}

export function projectSeneraSandboxTerminalMetadata(
  descriptor: SeneraTerminalBackendDescriptor,
  sandboxId: string,
): SeneraTerminalExecutionMetadata {
  return {
    requestedBoundary: "sandbox",
    effectiveBoundary: "sandbox",
    backendId: descriptor.id,
    shellDialect: descriptor.shellDialect,
    capabilities: [...descriptor.capabilities].sort(),
    capabilityProviders: descriptor.capabilityProviders,
    persistenceScope: descriptor.persistenceScope,
    sandboxId,
  };
}
