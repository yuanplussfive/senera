/**
 * Internal structural values consumed after AgentToolRunner has materialized
 * the package-owned WorkspaceApplyPatch JSON Schema. These types intentionally
 * do not duplicate model-facing validation or defaults.
 */
export type WorkspacePatchOperation =
  | { readonly kind: "add"; readonly path: string; readonly content: string }
  | { readonly kind: "update"; readonly path: string; readonly oldStr: string; readonly newStr: string }
  | { readonly kind: "write"; readonly path: string; readonly content: string }
  | { readonly kind: "delete"; readonly path: string }
  | { readonly kind: "move"; readonly source: string; readonly destination: string };

export interface WorkspaceApplyPatchArguments {
  readonly operations: readonly WorkspacePatchOperation[];
}

export type WorkspacePatchOperationResult =
  | { readonly kind: "add"; readonly path: string; readonly changedPaths: readonly string[] }
  | {
      readonly kind: "update";
      readonly path: string;
      readonly matches?: number;
      readonly changedPaths: readonly string[];
    }
  | { readonly kind: "write"; readonly path: string; readonly changedPaths: readonly string[] }
  | { readonly kind: "delete"; readonly path: string; readonly changedPaths: readonly string[] }
  | {
      readonly kind: "move";
      readonly source: string;
      readonly destination: string;
      readonly changedPaths: readonly string[];
    };

export interface WorkspacePatchExtensionValidation {
  readonly kind: "Skill" | "MCP";
  readonly name: string;
  readonly path: string;
  readonly status: "validated";
}

export interface WorkspaceApplyPatchResult {
  readonly text: string;
  readonly applied: true;
  readonly operationCount: number;
  readonly changedPaths: readonly string[];
  readonly operations: readonly WorkspacePatchOperationResult[];
  /** External transactions are reported separately from workspace-only undo checkpoints. */
  readonly externalChangedPaths?: readonly string[];
  readonly extensions: readonly WorkspacePatchExtensionValidation[];
}
