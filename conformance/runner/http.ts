// conformance/runner/http.ts
type Json = any;

export type HttpResult<T = Json> = {
  status: number;
  ok: boolean;
  json: T | null;
  text: string;
};

function joinUrl(baseUrl: string, path: string): string {
  const b = baseUrl.replace(/\/+$/g, "");
  const p = path.startsWith("/") ? path : `/${path}`;
  return `${b}${p}`;
}

export class LamHttp {
  constructor(
    private readonly baseUrl: string,
    private readonly token: string
  ) {}

  private async req(method: string, path: string, opts: { query?: Record<string, string>; body?: unknown } = {}): Promise<HttpResult> {
    const url = new URL(joinUrl(this.baseUrl, path));
    if (opts.query) {
      for (const [k, v] of Object.entries(opts.query)) url.searchParams.set(k, v);
    }

    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.token}`,
    };

    let body: string | undefined = undefined;
    if (opts.body !== undefined) {
      headers["Content-Type"] = "application/json";
      body = JSON.stringify(opts.body);
    }

    const res = await fetch(url.toString(), { method, headers, body });
    const text = await res.text();

    let json: any = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }

    return { status: res.status, ok: res.ok, json, text };
  }

  get(path: string, query?: Record<string, string>): Promise<HttpResult> {
    return this.req("GET", path, { query });
  }

  post(path: string, body: unknown): Promise<HttpResult> {
    return this.req("POST", path, { body });
  }
}

