import { AvesMessage } from "../../types/types";
import { AvesError } from "../AvesError";

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function isJsonSerializableValue(
  value: unknown,
  seen: WeakSet<object> = new WeakSet(),
): value is AvesMessage {
  if (value === null) {
    return true;
  }

  switch (typeof value) {
    case "string":
    case "boolean":
      return true;
    case "number":
      return Number.isFinite(value);
    case "object": {
      if (seen.has(value)) {
        return false;
      }
      seen.add(value);

      if (Array.isArray(value)) {
        const isSerializable = value.every((item) =>
          isJsonSerializableValue(item, seen),
        );
        seen.delete(value);
        return isSerializable;
      }

      const prototype = Object.getPrototypeOf(value);
      if (prototype !== Object.prototype && prototype !== null) {
        seen.delete(value);
        return false;
      }

      const isSerializable = Object.values(
        value as Record<string, unknown>,
      ).every((item) => isJsonSerializableValue(item, seen));
      seen.delete(value);
      return isSerializable;
    }
    default:
      return false;
  }
}

export function serializeUserMessage(message: AvesMessage): string {
  if (!isJsonSerializableValue(message)) {
    throw new AvesError({
      message:
        "Message must be JSON-serializable: use finite numbers, strings, booleans, null, arrays, and plain objects only",
      code: "MESSAGE_SERIALIZE_FAILED",
      stage: "transport",
      retryable: false,
    });
  }

  return JSON.stringify(message);
}
