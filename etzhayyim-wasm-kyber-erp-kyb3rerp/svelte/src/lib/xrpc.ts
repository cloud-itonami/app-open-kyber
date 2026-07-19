export type XrpcMethod = 'GET' | 'POST';
export type Json = Record<string, unknown>;

export interface XrpcResult<T = unknown> {
  ok: boolean;
  status: number;
  nsid: string;
  request: Json;
  response: T | { error?: string; message?: string };
}

export async function callXrpc<T = unknown>(
  nsid: string,
  payload: Json = {},
  method: XrpcMethod = 'POST'
): Promise<XrpcResult<T>> {
  const base = `/xrpc/${nsid}`;
  const url =
    method === 'GET'
      ? `${base}?${new URLSearchParams(
          Object.entries(payload).map(([k, v]) => [k, String(v ?? '')])
        ).toString()}`
      : base;

  const init: RequestInit =
    method === 'GET'
      ? { method: 'GET' }
      : {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload)
        };

  let status = 0;
  let response: unknown = null;
  try {
    const res = await fetch(url, init);
    status = res.status;
    const text = await res.text();
    try {
      response = text ? JSON.parse(text) : {};
    } catch {
      response = { raw: text };
    }
    return { ok: res.ok, status, nsid, request: payload, response: response as T };
  } catch (err) {
    return {
      ok: false,
      status,
      nsid,
      request: payload,
      response: { error: String(err) }
    };
  }
}

export function periodYM(d: Date = new Date()): string {
  return d.toISOString().slice(0, 7);
}
