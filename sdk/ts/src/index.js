"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.LamClient = exports.LamHttpError = void 0;
class LamHttpError extends Error {
    status;
    body;
    constructor(status, body) {
        super(`LAM HTTP ${status}`);
        this.status = status;
        this.body = body;
    }
}
exports.LamHttpError = LamHttpError;
function stripTrailingSlash(s) {
    return s.replace(/\/+$/, "");
}
function toQuery(params) {
    const sp = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
        if (v === undefined || v === null)
            continue;
        if (typeof v === "boolean")
            sp.set(k, v ? "1" : "0");
        else
            sp.set(k, String(v));
    }
    const qs = sp.toString();
    return qs ? `?${qs}` : "";
}
function addScopeToQuery(q, scope) {
    if (!scope)
        return;
    if (scope.scope_user !== undefined)
        q.scope_user = scope.scope_user;
    if (scope.scope_org !== undefined)
        q.scope_org = scope.scope_org;
    if (scope.scope_project !== undefined)
        q.scope_project = scope.scope_project;
    if (scope.namespace !== undefined)
        q.namespace = scope.namespace;
}
function addScopeToBody(body, scope) {
    if (!scope)
        return;
    if (scope.scope_user !== undefined)
        body.scope_user = scope.scope_user;
    if (scope.scope_org !== undefined)
        body.scope_org = scope.scope_org;
    if (scope.scope_project !== undefined)
        body.scope_project = scope.scope_project;
    if (scope.namespace !== undefined)
        body.namespace = scope.namespace;
}
async function readJsonSafe(res) {
    const text = await res.text().catch(() => "");
    if (!text)
        return null;
    try {
        return JSON.parse(text);
    }
    catch {
        return text;
    }
}
class LamClient {
    baseUrl;
    token;
    fetchImpl;
    userAgent;
    timeoutMs;
    constructor(opts) {
        this.baseUrl = stripTrailingSlash(opts.baseUrl);
        this.token = opts.token;
        this.fetchImpl = opts.fetch ?? fetch;
        this.userAgent = opts.userAgent;
        this.timeoutMs = typeof opts.timeoutMs === "number" ? opts.timeoutMs : 30_000;
    }
    async request(method, path, init) {
        const url = `${this.baseUrl}${path}${toQuery(init?.query ?? {})}`;
        const headers = {
            Authorization: `Bearer ${this.token}`,
        };
        if (this.userAgent)
            headers["User-Agent"] = this.userAgent;
        let body;
        if (init?.json !== undefined) {
            headers["Content-Type"] = "application/json";
            body = JSON.stringify(init.json);
        }
        const ac = new AbortController();
        const t = setTimeout(() => ac.abort(), this.timeoutMs);
        try {
            const res = await this.fetchImpl(url, { method, headers, body, signal: ac.signal });
            const parsed = await readJsonSafe(res);
            if (!res.ok)
                throw new LamHttpError(res.status, parsed);
            return parsed;
        }
        finally {
            clearTimeout(t);
        }
    }
    async ingest(content, opts) {
        const body = {
            content_type: opts?.content_type ?? "text/plain; charset=utf-8",
            content,
        };
        addScopeToBody(body, opts?.scope);
        return this.request("POST", "/v1/ingest", { json: body });
    }
    async recall(q, opts) {
        const query = { q };
        if (opts?.limit !== undefined)
            query.limit = opts.limit;
        if (opts?.include_tokens !== undefined)
            query.include_tokens = opts.include_tokens ? 1 : 0;
        addScopeToQuery(query, opts?.scope);
        return this.request("GET", "/v1/recall", { query });
    }
    async retrieve(q, opts) {
        const query = { q };
        if (opts?.limit !== undefined)
            query.limit = opts.limit;
        if (opts?.hops !== undefined)
            query.hops = opts.hops;
        if (opts?.k_seeds !== undefined)
            query.k_seeds = opts.k_seeds;
        if (opts?.k_expand !== undefined)
            query.k_expand = opts.k_expand;
        if (opts?.include_evidence !== undefined)
            query.include_evidence = opts.include_evidence ? 1 : 0;
        if (opts?.include_quotes !== undefined)
            query.include_quotes = opts.include_quotes ? 1 : 0;
        if (opts?.evidence_strategy !== undefined)
            query.evidence_strategy = opts.evidence_strategy;
        if (opts?.include_tokens !== undefined)
            query.include_tokens = opts.include_tokens ? 1 : 0;
        if (opts?.max_per_cell !== undefined)
            query.max_per_cell = opts.max_per_cell;
        if (opts?.as_of !== undefined)
            query.as_of = opts.as_of;
        addScopeToQuery(query, opts?.scope);
        return this.request("GET", "/v1/retrieve", { query });
    }
    async forgetByCellId(cell_id, opts) {
        const body = {
            cell_id,
            mode: opts?.mode ?? "hard",
            reason: opts?.reason ?? "",
        };
        addScopeToBody(body, opts?.scope);
        return this.request("POST", "/v1/forget", { json: body });
    }
    async forgetByQuery(q, opts) {
        const body = {
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
exports.LamClient = LamClient;
