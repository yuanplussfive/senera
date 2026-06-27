declare module "cross-spawn" {
  import type {
    SpawnOptions,
    SpawnSyncOptions,
    SpawnSyncOptionsWithBufferEncoding,
    SpawnSyncOptionsWithStringEncoding,
    SpawnSyncReturns,
  } from "node:child_process";
  import type { ChildProcess } from "node:child_process";

  export function spawn(
    command: string,
    args?: readonly string[],
    options?: SpawnOptions,
  ): ChildProcess;

  export function sync(command: string): SpawnSyncReturns<Buffer>;
  export function sync(command: string, args: readonly string[]): SpawnSyncReturns<Buffer>;
  export function sync(
    command: string,
    args: readonly string[],
    options: SpawnSyncOptionsWithStringEncoding,
  ): SpawnSyncReturns<string>;
  export function sync(
    command: string,
    args: readonly string[],
    options: SpawnSyncOptionsWithBufferEncoding,
  ): SpawnSyncReturns<Buffer>;
  export function sync(
    command: string,
    args?: readonly string[],
    options?: SpawnSyncOptions,
  ): SpawnSyncReturns<string | Buffer>;
}
