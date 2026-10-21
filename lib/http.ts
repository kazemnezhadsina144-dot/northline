export function json(status: number, body: unknown, extra: HeadersInit = {}): Response {
  return Response.json(body, {
    status,
    headers: {
      "cache-control": "no-store",
      ...Object.fromEntries(new Headers(extra).entries()),
    },
  });
}

export function clientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]?.trim() || "unknown";
  return "local";
}

export function rejectCrossOrigin(request: Request): Response | null {
  const origin = request.headers.get("origin");
  if (!origin) return null;
  let originHost = "";
  try {
    originHost = new URL(origin).host;
  } catch {
    return json(403, { error: "BAD_ORIGIN", message: "The request origin is not valid." });
  }
  const host = request.headers.get("host") ?? "";
  if (originHost !== host) {
    return json(403, { error: "BAD_ORIGIN", message: "Cross-origin swap requests are rejected." });
  }
  return null;
}

export async function readJson(request: Request, max = 4_096): Promise<unknown | Response> {
  const text = await request.text();
  if (text.length > max) {
    return json(413, { error: "BODY_TOO_LARGE", message: "The request is too large." });
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return json(400, { error: "BAD_JSON", message: "The request body is not valid JSON." });
  }
}

const buckets = new Map<string, { count: number; reset: number }>();

export function rateLimit(key: string, limit: number, windowMs: number, now = Date.now()): boolean {
  const current = buckets.get(key);
  if (!current || now >= current.reset) {
    buckets.set(key, { count: 1, reset: now + windowMs });
    return true;
  }
  if (current.count >= limit) return false;
  current.count += 1;
  return true;
}

export function resetRateLimits(): void {
  buckets.clear();
}
