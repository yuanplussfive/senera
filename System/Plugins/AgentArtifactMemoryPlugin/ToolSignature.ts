export type ArtifactMemoryRef =
  "summary" | "projection" | "evidence" | "delta" | "raw" | "workspaceDiff" | "workspacePatch";

export type ArtifactMemoryReadToolArguments = {
  // One or more canonical artifact memory URIs, for example "senera://artifact/art_1234567890abcdef12345678".
  artifactUris: {
    item: string[];
  };

  // Memory refs to load. Omit to read projection only.
  refs?: {
    item: ArtifactMemoryRef[];
  };

  // Optional per-ref response budget. Runtime caps this at the artifact text-file budget.
  maxBytesPerRef?: number;
};

export type ArtifactMemoryReadToolResult = {
  artifacts: {
    item: Array<{
      artifactUri: string;
      artifactId: string;
      status: "found" | "not_found" | "invalid";
      message: string;
      availableRefs: {
        item: Array<{
          ref: ArtifactMemoryRef;
          byteLength: number;
        }>;
      };
      availableRefCount: number;
      memories: {
        item: Array<{
          ref: ArtifactMemoryRef;
          content: string;
          byteLength: number;
          truncated: boolean;
        }>;
      };
      memoryCount: number;
    }>;
  };

  guidance: string;
};
