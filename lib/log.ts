function sensitive(key: string): boolean {
  const normalized = key.toLowerCase().replace(/[^a-z0-9]/g, "");
  return (
    normalized.includes("apikey") ||
    normalized === "authorization" ||
    normalized === "cookie" ||
    normalized === "secret" ||
    normalized === "password" ||
    normalized === "calldata" ||
    normalized === "data"
  );
}

export function log(
  level: "info" | "error",
  event: string,
  fields: Record<string, unknown> = {},
): void {
  const safe: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(fields)) {
    safe[key] = sensitive(key) ? "[redacted]" : value;
  }
  const line = JSON.stringify({
    ts: new Date().toISOString(),
    level,
    event,
    ...safe,
  });
  if (level === "error") console.error(line);
  else console.log(line);
}
