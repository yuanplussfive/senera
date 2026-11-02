import path from "node:path";
import { AgentJsonFileLoader } from "../../../Source/AgentSystem/Config/AgentJsonFileLoader.js";
import {
  discoverAgentSystemExtensionPackages,
  type AgentSystemExtensionPackageSource,
} from "../../../Source/AgentSystem/SystemTools/AgentSystemExtensionDiscovery.js";
import {
  AgentSystemToolContractSchema,
  type AgentSystemHostToolContribution,
  type AgentSystemToolContract,
} from "../../../Source/AgentSystem/SystemTools/AgentSystemExtensionManifest.js";
import { resolveSystemExtensionPackageFile } from "../../../Source/AgentSystem/SystemTools/AgentSystemExtensionPackagePath.js";
import {
  materializeToolContractArguments,
  validateToolContractValue,
  type AgentToolContractArgumentMaterialization,
  type AgentToolContractValidationIssue,
} from "../../../Source/AgentSystem/ToolRuntime/AgentToolSignatureArgumentValidator.js";

export interface LoadedSystemToolContract {
  readonly packageSource: AgentSystemExtensionPackageSource;
  readonly contribution: AgentSystemHostToolContribution;
  readonly contractPath: string;
  readonly contract: AgentSystemToolContract;
}

let publishedContracts: readonly LoadedSystemToolContract[] | undefined;

/**
 * Test support deliberately reads the same immutable package resources the
 * runtime catalog consumes. It keeps test assertions from reconstructing a
 * second public tool contract in TypeScript.
 */
export function loadSystemToolContractByCapability(capability: string): LoadedSystemToolContract {
  return findPublishedContract("capability", capability, (entry) => entry.contribution.capability === capability);
}

export function loadSystemToolContractByName(name: string): LoadedSystemToolContract {
  return findPublishedContract("name", name, (entry) => entry.contract.name === name);
}

export function materializeSystemToolArguments(
  contract: LoadedSystemToolContract,
  args: Readonly<Record<string, unknown>>,
): AgentToolContractArgumentMaterialization {
  return materializeToolContractArguments({ schema: contract.contract.inputSchema, args });
}

export function validateSystemToolOutput(
  contract: LoadedSystemToolContract,
  output: unknown,
): readonly AgentToolContractValidationIssue[] {
  return validateToolContractValue({ schema: contract.contract.outputSchema, value: output });
}

function findPublishedContract(
  label: "capability" | "name",
  value: string,
  predicate: (entry: LoadedSystemToolContract) => boolean,
): LoadedSystemToolContract {
  const matches = publishedSystemToolContracts().filter(predicate);
  if (matches.length === 1) return matches[0]!;
  if (matches.length === 0) throw new Error(`No published System Tool contract has ${label} '${value}'.`);
  throw new Error(`Multiple published System Tool contracts have ${label} '${value}'.`);
}

function publishedSystemToolContracts(): readonly LoadedSystemToolContract[] {
  if (publishedContracts) return publishedContracts;
  const loader = new AgentJsonFileLoader();
  publishedContracts = discoverAgentSystemExtensionPackages(path.resolve("System", "Extensions")).flatMap(
    (packageSource) =>
      (packageSource.manifest.contributions ?? []).flatMap((contribution) => {
        if (contribution.kind !== "hostTool") return [];
        const contractPath = resolveSystemExtensionPackageFile(
          packageSource.packageRoot,
          contribution.contract,
          "host Tool contract",
        );
        const contract = loader.load(contractPath, AgentSystemToolContractSchema);
        return [{ packageSource, contribution, contractPath, contract }];
      }),
  );
  return publishedContracts;
}
