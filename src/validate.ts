import type { StandardSchemaV1 } from '@standard-schema/spec';
import type { InvalidHandler } from './types/core';

/**
 * Builds a function that validates a value against an optional schema and
 * hands the schema's output to `dispatch`, or the issues to `reject`.
 * Without a schema it dispatches synchronously. Async validations are queued
 * so messages are still dispatched in the order they arrived.
 */
export function createValidator(onInvalid?: InvalidHandler) {
  let tail: Promise<void> | undefined;

  return (
    type: string,
    schema: StandardSchemaV1 | undefined,
    value: unknown,
    raw: unknown,
    dispatch: (value: unknown) => void,
    reject?: (issues: ReadonlyArray<StandardSchemaV1.Issue>) => void
  ): void => {
    const settle = (result: StandardSchemaV1.Result<unknown>): void => {
      if (!result.issues) return dispatch(result.value);
      if (onInvalid) onInvalid(type, result.issues, raw);
      else {
        console.warn(
          `river.ts: invalid '${type}' message dropped`,
          result.issues
        );
      }
      reject?.(result.issues);
    };
    const thrown = (error: unknown) =>
      settle({ issues: [{ message: String(error) }] });
    const run = (): void | Promise<void> => {
      if (!schema) return dispatch(value);
      let result: ReturnType<StandardSchemaV1['~standard']['validate']>;
      try {
        result = schema['~standard'].validate(value);
      } catch (error) {
        return thrown(error);
      }
      return result instanceof Promise
        ? result.then(settle, thrown)
        : settle(result);
    };

    if (!tail) {
      const pending = run();
      if (!pending) return;
      tail = pending;
    } else {
      tail = tail.then(run);
    }
    const mine: Promise<void> = (tail = tail
      .catch((error) => console.error('river.ts: handler error:', error))
      .then(() => {
        if (tail === mine) tail = undefined;
      }));
  };
}
