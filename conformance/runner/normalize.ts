// conformance/runner/normalize.ts
type RecallResponse = {
  q: string;
  results: Array<{
    atom_id: string;
    canonical: string;
    type: number;
    confidence: number | null;
    scope?: { user_id: string; org: string; project: string; namespace: string };
    created_at?: string;
    updated_at?: string;
  }>;
};

type RetrieveResponse = {
  lam_version: string;
  q: string;
  bundle: {
    atoms: Array<{ atom_id: string; type: number; canonical: string; confidence: number | null; score: number }>;
    edges: Array<{ src: string; type: number; dst: string; weight: number }>;
    why: {
      seeds: Array<{ atom_id: string; reasons: string[] }>;
      edges_used: Array<{ hop: number; src: string; type: number; dst: string; contrib: number }>;
      params: Record<string, unknown>;
    };
  };
  evidence?: Array<{
    evidence_id: string;
    atom_id: string;
    cell_id: string;
    span_type: string;
    start_pos: number;
    end_pos: number;
    transform: string;
    quote_budget: number;
    confidence: number | null;
    truncated?: boolean;
    text?: string;
  }>;
};

function normCanon(s: string): string {
  return String(s ?? "").trim().replace(/\s+/g, " ");
}

function atomKey(type: number, canonical: string): string {
  return `${type}:${normCanon(canonical)}`;
}

export function normalizeRecall(resp: RecallResponse): any {
  const items = (resp.results ?? []).map((r) => ({
    type: Number(r.type ?? 0),
    canonical: normCanon(r.canonical ?? ""),
    confidence: r.confidence ?? null,
    scope: r.scope
      ? {
          user_id: String(r.scope.user_id ?? ""),
          org: String(r.scope.org ?? ""),
          project: String(r.scope.project ?? ""),
          namespace: String(r.scope.namespace ?? ""),
        }
      : undefined,
  }));

  items.sort((a, b) => {
    const ak = atomKey(a.type, a.canonical);
    const bk = atomKey(b.type, b.canonical);
    if (ak !== bk) return ak.localeCompare(bk);
    // confidence desc
    return (b.confidence ?? 0) - (a.confidence ?? 0);
  });

  return { q: String(resp.q ?? ""), results: items };
}

export function normalizeRetrieve(resp: RetrieveResponse): any {
  const atoms = (resp.bundle?.atoms ?? []).map((a) => ({
    id: String(a.atom_id ?? ""),
    type: Number(a.type ?? 0),
    canonical: normCanon(a.canonical ?? ""),
    confidence: a.confidence ?? null,
    score: Number(a.score ?? 0),
  }));

  const idToKey = new Map<string, string>();
  for (const a of atoms) idToKey.set(a.id, atomKey(a.type, a.canonical));

  const atomsOut = atoms
    .map((a) => ({
      key: idToKey.get(a.id) ?? atomKey(a.type, a.canonical),
      type: a.type,
      canonical: a.canonical,
      confidence: a.confidence,
      score: a.score,
    }))
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      if (a.key !== b.key) return a.key.localeCompare(b.key);
      return 0;
    });

  const edgesOut = (resp.bundle?.edges ?? [])
    .map((e) => ({
      src: idToKey.get(String(e.src ?? "")) ?? String(e.src ?? ""),
      type: Number(e.type ?? 0),
      dst: idToKey.get(String(e.dst ?? "")) ?? String(e.dst ?? ""),
      weight: Number(e.weight ?? 0),
    }))
    .sort((a, b) => {
      if (a.src !== b.src) return a.src.localeCompare(b.src);
      if (a.type !== b.type) return a.type - b.type;
      if (a.dst !== b.dst) return a.dst.localeCompare(b.dst);
      return 0;
    });

  const seedsOut = (resp.bundle?.why?.seeds ?? [])
    .map((s) => ({
      atom: idToKey.get(String(s.atom_id ?? "")) ?? String(s.atom_id ?? ""),
      reasons: Array.isArray(s.reasons) ? [...s.reasons].sort() : [],
    }))
    .sort((a, b) => a.atom.localeCompare(b.atom));

  const edgesUsedOut = (resp.bundle?.why?.edges_used ?? [])
    .map((e) => ({
      hop: Number(e.hop ?? 0),
      src: idToKey.get(String(e.src ?? "")) ?? String(e.src ?? ""),
      type: Number(e.type ?? 0),
      dst: idToKey.get(String(e.dst ?? "")) ?? String(e.dst ?? ""),
      contrib: Number(e.contrib ?? 0),
    }))
    .sort((a, b) => {
      if (b.contrib !== a.contrib) return b.contrib - a.contrib;
      if (a.hop !== b.hop) return a.hop - b.hop;
      if (a.src !== b.src) return a.src.localeCompare(b.src);
      if (a.type !== b.type) return a.type - b.type;
      if (a.dst !== b.dst) return a.dst.localeCompare(b.dst);
      return 0;
    });

  const evidenceOut = (resp.evidence ?? [])
    .map((e) => ({
      atom: idToKey.get(String(e.atom_id ?? "")) ?? String(e.atom_id ?? ""),
      cell_id: String(e.cell_id ?? ""),
      span_type: String(e.span_type ?? ""),
      start_pos: Number(e.start_pos ?? 0),
      end_pos: Number(e.end_pos ?? 0),
      transform: String(e.transform ?? ""),
      quote_budget: Number(e.quote_budget ?? 0),
      confidence: e.confidence ?? null,
      truncated: e.truncated ?? false,
      text: e.text ?? undefined,
    }))
    .sort((a, b) => {
      if (a.atom !== b.atom) return a.atom.localeCompare(b.atom);
      if (a.cell_id !== b.cell_id) return a.cell_id.localeCompare(b.cell_id);
      if (a.start_pos !== b.start_pos) return a.start_pos - b.start_pos;
      if (a.end_pos !== b.end_pos) return a.end_pos - b.end_pos;
      return 0;
    });

  return {
    lam_version: String(resp.lam_version ?? ""),
    q: String(resp.q ?? ""),
    bundle: {
      atoms: atomsOut,
      edges: edgesOut,
      why: {
        seeds: seedsOut,
        edges_used: edgesUsedOut,
        params: resp.bundle?.why?.params ?? {},
      },
    },
    evidence: evidenceOut,
  };
}

