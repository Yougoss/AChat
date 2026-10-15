export function serialize(value: unknown): string {
  const serialized = JSON.stringify(value);
  if (serialized === undefined) throw new TypeError("Value must be JSON serializable");
  return serialized;
}

export function deserialize<T>(value: string): T {
  return JSON.parse(value) as T;
}

export function asRecord<T>(value: unknown): T {
  return value as T;
}

export function asRecords<T>(value: unknown): T[] {
  return value as T[];
}
