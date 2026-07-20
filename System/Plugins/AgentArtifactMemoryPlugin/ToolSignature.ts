export type ArtifactMemoryRef =
  | "summary"
  | "projection"
  | "evidence"
  | "delta"
  | "raw"
  | "rawBlob"
  | "rawPreview"
  | "workspaceDiff"
  | "workspacePatch"
  | "stdout"
  | "stderr";

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

  // UTF-8 byte offset applied to each requested ref. Use a prior range.nextStartByte to continue.
  startBytePerRef?: number;

  // Optional per-ref ranges. This avoids applying one offset/budget to unrelated refs.
  refRanges?: Array<{
    ref: ArtifactMemoryRef;
    maxBytes: number;
    startByte?: number;
  }>;
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
          mediaType?: string;
          sha256?: string;
        }>;
      };
      availableRefCount: number;
      refResults: {
        item: Array<{
          ref: ArtifactMemoryRef;
          status: "loaded" | "unavailable" | "too_large" | "failed";
          message: string;
          sourceByteLength?: number;
          structuredJsonMaxBytes?: number;
          alternativeRef?: ArtifactMemoryRef;
        }>;
      };
      unavailableRefCount: number;
      oversizedRefCount: number;
      failedRefCount: number;
      memories: {
        item: Array<{
          ref: ArtifactMemoryRef;
          sourceSha256?: string;
          range: {
            startByte: number;
            endByte: number;
            totalBytes: number;
            returnedBytes: number;
            complete: boolean;
            nextStartByte?: number;
          };
          content: string;
        }>;
      };
      memoryCount: number;
    }>;
  };

  guidance: string;
};
