/**
 * Shared base class for all Senera Agent custom errors.
 *
 * Subclasses are identified by their class name automatically — no need to
 * manually set `this.name` in each constructor. This eliminates the
 * boilerplate and inconsistency seen across 50+ error subclasses where some
 * forgot to set `this.name` at all.
 *
 * ## Usage
 *
 * ```ts
 * export class MyCustomError extends AgentBaseError {
 *   constructor(readonly context: string) {
 *     super(`Something went wrong: ${context}`);
 *   }
 * }
 * ```
 *
 * The `this.name` property is automatically set to `"MyCustomError"` via
 * `new.target.name`, so `instanceof` checks and error logging produce the
 * correct class name without any per-subclass boilerplate.
 *
 * ## ErrorOptions support
 *
 * The constructor accepts an optional `ErrorOptions` parameter (forwarded to
 * `Error`), enabling the standard `cause` chain:
 *
 * ```ts
 * throw new MyCustomError("disk full", { cause: originalError });
 * ```
 */
export abstract class AgentBaseError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    // Auto-set name to the actual subclass name, eliminating per-subclass
    // `this.name = "..."` boilerplate. `new.target` refers to the constructor
    // that was actually invoked, so this works correctly through inheritance
    // chains.
    this.name = new.target.name;
  }
}
