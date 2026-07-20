export type FetchResult<T> = { ok: true; data: T } | { ok: false; error: string; status: number };

export async function fetchJson<T>(input: RequestInfo | URL, init?: RequestInit): Promise<FetchResult<T>> {
  try {
    const res = await fetch(input, init);
    // `status` is the HTTP status on an HTTP failure, or 0 on a transport failure (no response).
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}`, status: res.status };
    return { ok: true, data: (await res.json()) as T };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err), status: 0 };
  }
}
