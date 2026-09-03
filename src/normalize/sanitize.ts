const SECRET_QUERY_VALUE = /((?:[?&]|&amp;)(?:access_token|token|verifier|key)=)[^&#\s"'<>]*/gi;
const BEARER_VALUE = /(Bearer\s+)[A-Za-z0-9._~-]+/gi;

export function sanitizeSourceText(value: string) {
  return value.replace(SECRET_QUERY_VALUE, "$1[redacted]").replace(BEARER_VALUE, "$1[redacted]");
}

export function sanitizeSourceValue(value: unknown): unknown {
  if (typeof value === "string") return sanitizeSourceText(value);
  if (Array.isArray(value)) return value.map(sanitizeSourceValue);
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, entry]) => [
        key,
        sanitizeSourceValue(entry),
      ]),
    );
  }
  return value;
}
