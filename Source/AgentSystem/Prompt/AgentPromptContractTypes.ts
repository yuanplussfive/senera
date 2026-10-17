import type ts from "typescript";

export interface AgentPromptContractProperty {
  name: string;
  displayName: string;
  path: string;
  depth: number;
  kind: "scalar" | "object" | "array";
  typeText: string;
  required: boolean;
  comment: string;
  xmlHint: string;
  children: AgentPromptContractProperty[];
  element?: AgentPromptContractProperty;
  elements: AgentPromptContractProperty[];
}

export interface AgentPromptContractView {
  tsHintLines: string[];
  xmlPreview: string;
  properties: AgentPromptContractProperty[];
  jsonSchema: Record<string, unknown>;
}

export interface ContractProjectionNode {
  name: string;
  displayName: string;
  path: string;
  depth: number;
  kind: "scalar" | "object" | "array";
  typeText: string;
  required: boolean;
  comment: string;
  xmlHint: string;
  children: ContractProjectionNode[];
  element?: ContractProjectionNode;
  elements: ContractProjectionNode[];
}

export type ResolvedTypeShape =
  | {
      kind: "object";
      members: ts.NodeArray<ts.TypeElement>;
    }
  | {
      kind: "array";
      elementType: ts.TypeNode;
    }
  | {
      kind: "scalar";
    };
