// Client-side helper for the market workbench pages: every POST to the market API needs the
// admin CSRF token (adminHandler enforces x-csrf-token on non-GET). The token comes from the
// same-origin /api/admin/me endpoint the admin feature already uses; it is cached per page life.
let cachedCsrf: string | null = null;

export async function marketCsrf(): Promise<string> {
  if (cachedCsrf) return cachedCsrf;
  const me = await fetch("/api/admin/me", { credentials: "same-origin" }).then((r) => (r.ok ? r.json() : null));
  cachedCsrf = (me?.csrf as string | undefined) ?? "";
  return cachedCsrf;
}

/** POST JSON to a market API route with the CSRF header; returns {status, body}. */
export async function marketPost<T = unknown>(path: string, body?: unknown): Promise<{ status: number; body: T | null }> {
  const csrf = await marketCsrf();
  const res = await fetch(path, {
    method: "POST",
    credentials: "same-origin",
    headers: { "content-type": "application/json", "x-csrf-token": csrf },
    body: JSON.stringify(body ?? {}),
  });
  const text = await res.text();
  return { status: res.status, body: text ? (JSON.parse(text) as T) : null };
}
