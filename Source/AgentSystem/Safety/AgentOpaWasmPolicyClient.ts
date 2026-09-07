import type { PolicyClient } from "@ai-sdk/policy-opa";
import { loadPolicy } from "@open-policy-agent/opa-wasm";

interface OpaWasmResult {
  readonly result: unknown;
}

export async function createAgentOpaWasmPolicyClient(options: {
  readonly wasm: Uint8Array | ArrayBuffer;
  readonly data?: object;
}): Promise<PolicyClient> {
  const wasm = options.wasm instanceof Uint8Array ? Uint8Array.from(options.wasm).buffer : options.wasm;
  const policy = await loadPolicy(wasm);
  if (options.data !== undefined) {
    policy.setData(options.data);
  }

  return {
    async evaluate<TInput = unknown, TResult = unknown>(pathName: string, input: TInput): Promise<TResult> {
      let results: unknown;
      try {
        results = policy.evaluate(input, pathName);
      } catch (error) {
        throw new Error(`OPA WASM entrypoint evaluation failed: ${pathName}`, {
          cause: error,
        });
      }
      if (!isOpaWasmResultSet(results)) {
        throw new Error(`OPA WASM entrypoint produced no result: ${pathName}`);
      }
      return results[0].result as TResult;
    },
  };
}

function isOpaWasmResultSet(value: unknown): value is [OpaWasmResult, ...OpaWasmResult[]] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value[0] !== null &&
    typeof value[0] === "object" &&
    "result" in value[0]
  );
}
