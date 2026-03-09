// conformance/runner/asserts.ts
export class AssertionError extends Error {
  readonly name = "AssertionError";
}

export function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new AssertionError(message);
}

export function assertEq<T>(a: T, b: T, message: string): void {
  if (a !== b) throw new AssertionError(`${message} (got ${String(a)} expected ${String(b)})`);
}

