export type EvidenceStrategy = "per_atom_best" | "max_span" | "min_span";

export type ClaimType = "ENTITY" | "EVENT" | "PREFERENCE" | "FACT" | "PROCEDURE";

export type IngestClaim = {
  type: ClaimType | 1 | 2 | 3 | 4 | 5;
  canonical: string;
  confidence?: number;
};

export type Scope = {
  scope_user?: string;
  scope_org?: string;
  scope_project?: string;
  namespace?: string;
};

export type LamClientOptions = {
  baseUrl: string; // e.g. http://127.0.0.1:8080
  token: string;
  fetch?: typeof fetch; // override for runtimes without global fetch
  userAgent?: string;
  timeoutMs?: number;
};

export type IngestOptions = {
  content_type?: string;
  claims?: IngestClaim[];
  scope?: Scope;
};

export type RecallOptions = {
  limit?: number;
  include_tokens?: boolean;
  scope?: Scope;
};

export type RetrieveOptions = {
  limit?: number;
  hops?: number;
  k_seeds?: number;
  k_expand?: number;
  include_evidence?: boolean;
  include_quotes?: boolean;
  evidence_strategy?: EvidenceStrategy;
  include_tokens?: boolean;
  max_per_cell?: number;
  as_of?: string;
  scope?: Scope;
};

export type ForgetByCellIdOptions = {
  mode?: "hard" | "tombstone";
  reason?: string;
  scope?: Scope;
};

export type ForgetByQueryOptions = {
  limit_cells?: number;
  include_tokens?: boolean;
  mode?: "hard" | "tombstone";
  reason?: string;
  scope?: Scope;
};

export class LamHttpError extends Error {
  status: number;
  body: unknown;
  constructor(status: number, body: unknown) {
    super(`LAM HTTP ${status}`);
    this.status = status;
    this.body = body;
  }
}

function stripTrailingSlash(s: string): string {
  return s.replace(/\/+$/, "");
}

function toQuery(params: Record<string, string | number | boolean | undefined | null>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null) continue;
    if (typeof v === "boolean") sp.set(k, v ? "1" : "0");
    else sp.set(k, String(v));
  }
  const qs = sp.toString();
  return qs ? `?${qs}` : "";
}

function addScopeToQuery(q: Record<string, any>, scope?: Scope): void {
  if (!scope) return;
  if (scope.scope_user !== undefined) q.scope_user = scope.scope_user;
  if (scope.scope_org !== undefined) q.scope_org = scope.scope_org;
  if (scope.scope_project !== undefined) q.scope_project = scope.scope_project;
  if (scope.namespace !== undefined) q.namespace = scope.namespace;
}

function addScopeToBody(body: Record<string, any>, scope?: Scope): void {
  if (!scope) return;
  if (scope.scope_user !== undefined) body.scope_user = scope.scope_user;
  if (scope.scope_org !== undefined) body.scope_org = scope.scope_org;
  if (scope.scope_project !== undefined) body.scope_project = scope.scope_project;
  if (scope.namespace !== undefined) body.namespace = scope.namespace;
}

function bytesToBase64(bytes: Uint8Array): string {
  const B = (globalThis as any).Buffer;
  if (B && typeof B.from === "function") {
    return B.from(bytes).toString("base64");
  }

  // Browser fallback (btoa)
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    const sub = bytes.subarray(i, i + chunk);
    bin += String.fromCharCode(...Array.from(sub));
  }
  return btoa(bin);
}

async function readJsonSafe(res: Response): Promise<unknown> {
  const text = await res.text().catch(() => "");
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export class LamClient {
  private baseUrl: string;
  private token: string;
  private fetchImpl: typeof fetch;
  private userAgent?: string;
  private timeoutMs: number;

  constructor(opts: LamClientOptions) {
    this.baseUrl = stripTrailingSlash(opts.baseUrl);
    this.token = opts.token;
    this.fetchImpl = opts.fetch ?? fetch;
    this.userAgent = opts.userAgent;
    this.timeoutMs = typeof opts.timeoutMs === "number" ? opts.timeoutMs : 30_000;
  }

  private async request<T>(method: string, path: string, init?: { query?: Record<string, any>; json?: any }): Promise<T> {
    const url = `${this.baseUrl}${path}${toQuery(init?.query ?? {})}`;
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.token}`,
    };
    if (this.userAgent) headers["User-Agent"] = this.userAgent;

    let body: string | undefined;
    if (init?.json !== undefined) {
      headers["Content-Type"] = "application/json";
      body = JSON.stringify(init.json);
    }

    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), this.timeoutMs);
    try {
      const res = await this.fetchImpl(url, { method, headers, body, signal: ac.signal });
      const parsed = await readJsonSafe(res);
      if (!res.ok) throw new LamHttpError(res.status, parsed);
      return parsed as T;
    } finally {
      clearTimeout(t);
    }
  }

  async ingest(content: string, opts?: IngestOptions): Promise<{ cell_id: string; atoms_upserted: number; edges_updated: number }> {
    const body: Record<string, any> = {
      content_type: opts?.content_type ?? "text/plain; charset=utf-8",
      content,
    };
    if (opts?.claims) body.claims = opts.claims;
    addScopeToBody(body, opts?.scope);
    return this.request("POST", "/v1/ingest", { json: body });
  }

  async ingestBytes(
    bytes: Uint8Array,
    opts?: IngestOptions
  ): Promise<{ cell_id: string; atoms_upserted: number; edges_updated: number }> {
    const body: Record<string, any> = {
      content_type: opts?.content_type ?? "application/octet-stream",
      content_b64: bytesToBase64(bytes),
    };
    if (opts?.claims) body.claims = opts.claims;
    addScopeToBody(body, opts?.scope);
    return this.request("POST", "/v1/ingest", { json: body });
  }

  async recall(q: string, opts?: RecallOptions): Promise<{ q: string; results: any[] }> {
    const query: Record<string, any> = { q };
    if (opts?.limit !== undefined) query.limit = opts.limit;
    if (opts?.include_tokens !== undefined) query.include_tokens = opts.include_tokens ? 1 : 0;
    addScopeToQuery(query, opts?.scope);
    return this.request("GET", "/v1/recall", { query });
  }

  async retrieve(q: string, opts?: RetrieveOptions): Promise<any> {
    const query: Record<string, any> = { q };
    if (opts?.limit !== undefined) query.limit = opts.limit;
    if (opts?.hops !== undefined) query.hops = opts.hops;
    if (opts?.k_seeds !== undefined) query.k_seeds = opts.k_seeds;
    if (opts?.k_expand !== undefined) query.k_expand = opts.k_expand;
    if (opts?.include_evidence !== undefined) query.include_evidence = opts.include_evidence ? 1 : 0;
    if (opts?.include_quotes !== undefined) query.include_quotes = opts.include_quotes ? 1 : 0;
    if (opts?.evidence_strategy !== undefined) query.evidence_strategy = opts.evidence_strategy;
    if (opts?.include_tokens !== undefined) query.include_tokens = opts.include_tokens ? 1 : 0;
    if (opts?.max_per_cell !== undefined) query.max_per_cell = opts.max_per_cell;
    if (opts?.as_of !== undefined) query.as_of = opts.as_of;
    addScopeToQuery(query, opts?.scope);
    return this.request("GET", "/v1/retrieve", { query });
  }

  async forgetByCellId(cell_id: string, opts?: ForgetByCellIdOptions): Promise<any> {
    const body: Record<string, any> = {
      cell_id,
      mode: opts?.mode ?? "hard",
      reason: opts?.reason ?? "",
    };
    addScopeToBody(body, opts?.scope);
    return this.request("POST", "/v1/forget", { json: body });
  }

  async forgetByQuery(q: string, opts?: ForgetByQueryOptions): Promise<any> {
    const body: Record<string, any> = {
      q,
      limit_cells: opts?.limit_cells ?? 25,
      include_tokens: opts?.include_tokens ? 1 : 0,
      mode: opts?.mode ?? "hard",
      reason: opts?.reason ?? "",
    };
    addScopeToBody(body, opts?.scope);
    return this.request("POST", "/v1/forget", { json: body });
  }
}
