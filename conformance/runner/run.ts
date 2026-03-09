// conformance/runner/run.ts
import crypto from "crypto";
import { promises as fs } from "fs";
import path from "path";

import { assert, assertEq, AssertionError } from "./asserts";
import { LamHttp } from "./http";
import { normalizeRecall, normalizeRetrieve } from "./normalize";

type Fixture =
  | { id: string; kind: "basic_text"; content: string; expects: { pref_canonical: string; must_have_quotes: string[]; must_have_exact_quotes: string[] } }
  | { id: string; kind: "scope_isolation"; content: string }
  | { id: string; kind: "dedupe_idempotent"; content: string; expects: { pref_canonical: string } }
  | { id: string; kind: "evidence_roundtrip"; content: string }
  | { id: string; kind: "context_roundtrip"; content: string; query?: string }
  | {
      id: string;
      kind: "state_over_time";
      content: string;
      expects: { now_query: string; past_query: string; now_canonical: string; past_canonical: string };
    }
  | {
      id: string;
      kind: "contradiction_cluster";
      objects: string[];
      expects: { must_include_canonicals: string[]; must_exclude_canonicals: string[] };
    }
  | {
      id: string;
      kind: "idish_substring_collision";
      content_exact: string;
      content_super: string;
      expects: { must_include_canonical: string; must_exclude_canonical: string };
    }
  | {
      id: string;
      kind: "pdf_text_evidence";
      content_type: string;
      asset_b64_path: string;
      query: string;
      expects: { canonical: string; quote_substring: string; span_type: string; transform_prefix: string };
    }
  | {
      id: string;
      kind: "upstream_text_view_claim_evidence";
      content_type: string;
      asset_b64_path: string;
      text_transform: string;
      text_template: string;
      expects: { span_type: string; transform_prefix: string };
    }
  | { id: string; kind: "retrieve_determinism"; content_1: string; content_2: string; expects: { must_include_canonical: string; must_exclude_canonical: string } }
  | { id: string; kind: "forget_retention"; content: string }
  | { id: string; kind: "scope_selector"; allowed: Record<string, string>; forbidden: Record<string, string> };

type Ctx = {
  baseUrl: string;
  a: LamHttp;
  b: LamHttp;
  selector?: LamHttp;
  runId: string;
};

type Cli = {
  only: string[];
  outPath: string;
};

function parseCli(argv: string[]): Cli {
  const only: string[] = [];
  let outPath = "";

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--out") {
      const next = argv[i + 1];
      if (!next) throw new Error("Missing value for --out");
      outPath = next;
      i++;
      continue;
    }
    only.push(a);
  }

  return { only, outPath };
}

function fixtureToken(runId: string, fixtureId: string): string {
  const n = fixtureId.match(/^(\d+)/)?.[1] ?? fixtureId.replace(/[^0-9]/g, "").slice(0, 3) ?? "000";
  return `lamconf${runId}${n}`;
}

async function loadFixtures(): Promise<Fixture[]> {
  const dir = path.resolve(process.cwd(), "conformance/fixtures");
  const files = (await fs.readdir(dir)).filter((f) => f.endsWith(".json")).sort();
  const out: Fixture[] = [];

  for (const f of files) {
    const p = path.join(dir, f);
    const raw = await fs.readFile(p, "utf8");
    out.push(JSON.parse(raw));
  }

  return out;
}

function fail(name: string, err: unknown): { name: string; ok: false; error: string } {
  const msg = err instanceof Error ? err.message : String(err);
  return { name, ok: false, error: msg };
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitForEnrichment(http: LamHttp, cellId: string, timeoutMs = 30_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let last: any = null;

  while (Date.now() < deadline) {
    const res = await http.get("/v1/enrichment/status", { cell_id: cellId });
    last = res;

    if (res.ok) {
      const status = String((res.json as any)?.status ?? "");
      if (status === "done") return;
      if (status === "failed") {
        const err = String((res.json as any)?.last_error ?? "");
        throw new Error(`enrichment failed for cell_id=${cellId}: ${err || "unknown"}`);
      }
    }

    await sleep(100);
  }

  const lastStatus = last ? ` last_status=${last.status}` : "";
  throw new Error(`timed out waiting for enrichment for cell_id=${cellId}.${lastStatus}`);
}

async function conformanceIngest(http: LamHttp, content: string): Promise<string> {
  const res = await http.post("/v1/ingest", { content_type: "text/plain; charset=utf-8", content });
  assert(res.ok, `ingest failed: HTTP ${res.status} ${res.text}`);
  const cellId = String((res.json as any)?.cell_id ?? "");
  assert(cellId, "ingest response missing cell_id");
  await waitForEnrichment(http, cellId);
  return cellId;
}

async function conformanceIngestB64(http: LamHttp, p: { contentType: string; contentB64: string; textViews?: any[]; claims?: any[] }): Promise<string> {
  const body: any = { content_type: p.contentType, content_b64: p.contentB64 };
  if (Array.isArray(p.textViews) && p.textViews.length > 0) body.text_views = p.textViews;
  if (Array.isArray(p.claims) && p.claims.length > 0) body.claims = p.claims;

  const res = await http.post("/v1/ingest", body);
  assert(res.ok, `ingest failed: HTTP ${res.status} ${res.text}`);
  const cellId = String((res.json as any)?.cell_id ?? "");
  assert(cellId, "ingest response missing cell_id");
  await waitForEnrichment(http, cellId);
  return cellId;
}

async function conformanceForgetByCellId(http: LamHttp, cellId: string): Promise<void> {
  const res = await http.post("/v1/forget", { cell_id: cellId, mode: "hard", reason: "conformance-cleanup" });
  assert(res.ok, `forget failed: HTTP ${res.status} ${res.text}`);
}

function evidenceMaxSpan(evidence: any[]): any | null {
  if (!Array.isArray(evidence) || evidence.length === 0) return null;
  return [...evidence].sort((a, b) => (Number(b.end_pos) - Number(b.start_pos)) - (Number(a.end_pos) - Number(a.start_pos)))[0] ?? null;
}

async function testBasicText(ctx: Ctx, fx: Extract<Fixture, { kind: "basic_text" }>) {
  const tok = fixtureToken(ctx.runId, fx.id);
  const content = `${tok} ${fx.content}`;

  const cellId = await conformanceIngest(ctx.a, content);
  try {
    // recall: ensure preference statement exists
    const recallRes = await ctx.a.get("/v1/recall", { q: "prefer", limit: "50" });
    assert(recallRes.ok, `recall failed: HTTP ${recallRes.status} ${recallRes.text}`);
    const recallNorm = normalizeRecall(recallRes.json as any);
    const hasPref = (recallNorm.results as any[]).some((r) => r.type === 3 && r.canonical === fx.expects.pref_canonical);
    assert(hasPref, `recall missing expected pref atom: "${fx.expects.pref_canonical}"`);

    // retrieve: quotes + decode
    const retrieveRes = await ctx.a.get("/v1/retrieve", {
      q: tok,
      include_quotes: "1",
      evidence_strategy: "max_span",
      limit: "12",
    });
    assert(retrieveRes.ok, `retrieve failed: HTTP ${retrieveRes.status} ${retrieveRes.text}`);

    const rjson = retrieveRes.json as any;
    assert(Array.isArray(rjson?.evidence), "retrieve missing evidence[] with include_quotes=1");

    const texts = (rjson.evidence as any[]).map((e) => String(e.text ?? ""));
    for (const s of fx.expects.must_have_quotes) {
      assert(texts.some((t) => t.includes(s)), `missing expected quote substring: "${s}"`);
    }
    for (const s of fx.expects.must_have_exact_quotes) {
      assert(texts.some((t) => t === s), `missing expected exact quote: "${s}"`);
    }

    const best = evidenceMaxSpan(rjson.evidence);
    assert(best && best.evidence_id, "retrieve evidence missing evidence_id");

    const dec = await ctx.a.get("/v1/decode", { evidence_id: String(best.evidence_id) });
    assert(dec.ok, `decode failed: HTTP ${dec.status} ${dec.text}`);
    assertEq(String((dec.json as any)?.text ?? ""), String(best.text ?? ""), "decode text must match retrieve quote text");
  } finally {
    await conformanceForgetByCellId(ctx.a, cellId);
  }
}

async function testScopeIsolation(ctx: Ctx, fx: Extract<Fixture, { kind: "scope_isolation" }>) {
  const tok = fixtureToken(ctx.runId, fx.id);
  const content = `${tok} ${fx.content}`;

  const cellId = await conformanceIngest(ctx.a, content);
  try {
    const aRecall = await ctx.a.get("/v1/recall", { q: tok, limit: "20" });
    assert(aRecall.ok, `recall(A) failed: HTTP ${aRecall.status} ${aRecall.text}`);
    assert(((aRecall.json as any)?.results?.length ?? 0) > 0, "recall(A) returned empty results");

    const aRetrieve = await ctx.a.get("/v1/retrieve", { q: tok, include_evidence: "1", evidence_strategy: "per_atom_best", limit: "10" });
    assert(aRetrieve.ok, `retrieve(A) failed: HTTP ${aRetrieve.status} ${aRetrieve.text}`);
    const evidence = (aRetrieve.json as any)?.evidence;
    assert(Array.isArray(evidence) && evidence.length > 0, "retrieve(A) missing evidence[]");

    const bRecall = await ctx.b.get("/v1/recall", { q: tok, limit: "20" });
    assert(bRecall.ok, `recall(B) failed: HTTP ${bRecall.status} ${bRecall.text}`);
    assertEq(((bRecall.json as any)?.results?.length ?? 0) as any, 0 as any, "recall(B) must return empty results");

    const evId = String(evidence[0]?.evidence_id ?? "");
    assert(evId, "missing evidence_id in retrieve(A) evidence");
    const bDecode = await ctx.b.get("/v1/decode", { evidence_id: evId });
    assertEq(bDecode.status, 404, "decode(B) must 404 for evidence_id outside scope");
  } finally {
    await conformanceForgetByCellId(ctx.a, cellId);
  }
}

async function testDedupeIdempotent(ctx: Ctx, fx: Extract<Fixture, { kind: "dedupe_idempotent" }>) {
  const tok = fixtureToken(ctx.runId, fx.id);
  const content = `${tok} ${fx.content}`;

  const cellId1 = await conformanceIngest(ctx.a, content);
  const cellId2 = await conformanceIngest(ctx.a, content);

  assertEq(cellId1, cellId2, "ingesting identical content must return same cell_id");

  try {
    const recallRes = await ctx.a.get("/v1/recall", { q: "pineapple", limit: "100" });
    assert(recallRes.ok, `recall failed: HTTP ${recallRes.status} ${recallRes.text}`);

    const results = ((recallRes.json as any)?.results ?? []) as any[];
    const hits = results.filter((r) => Number(r.type) === 3 && String(r.canonical ?? "").trim() === fx.expects.pref_canonical);
    assertEq(hits.length, 1, `expected exactly 1 pref atom with canonical "${fx.expects.pref_canonical}"`);

    // also ensure no duplicate (type, canonical) pairs overall
    const seen = new Set<string>();
    for (const r of results) {
      const key = `${Number(r.type)}:${String(r.canonical ?? "").trim()}`;
      assert(!seen.has(key), `duplicate atom in recall results: ${key}`);
      seen.add(key);
    }
  } finally {
    await conformanceForgetByCellId(ctx.a, cellId1);
  }
}

async function testStateOverTime(ctx: Ctx, fx: Extract<Fixture, { kind: "state_over_time" }>) {
  const tok = fixtureToken(ctx.runId, fx.id);
  const content = `${tok} ${String(fx.content ?? "").replaceAll("{{TOK}}", tok)}`.trim();
  assert(content.includes("used to") && content.includes("now"), "state_over_time content must include a used-to -> now change");

  const cellId = await conformanceIngest(ctx.a, content);

  try {
    const asOf = new Date().toISOString();
    const nowQuery = String(fx.expects.now_query ?? "").replaceAll("{{TOK}}", tok).trim() || `${tok} now`;
    const pastQuery = String(fx.expects.past_query ?? "").replaceAll("{{TOK}}", tok).trim() || `${tok} before`;
    const nowCanon = String(fx.expects.now_canonical ?? "").replaceAll("{{TOK}}", tok).trim();
    const pastCanon = String(fx.expects.past_canonical ?? "").replaceAll("{{TOK}}", tok).trim();

    assert(nowCanon && pastCanon, "state_over_time expects must include now_canonical and past_canonical");

    const commonParams = { limit: "50", as_of: asOf, include_evidence: "1", evidence_strategy: "per_atom_best", max_per_cell: "0" };

    const rNow1 = await ctx.a.get("/v1/retrieve", { q: nowQuery, ...commonParams });
    assert(rNow1.ok, `retrieve(now:1) failed: HTTP ${rNow1.status} ${rNow1.text}`);
    const rNow2 = await ctx.a.get("/v1/retrieve", { q: nowQuery, ...commonParams });
    assert(rNow2.ok, `retrieve(now:2) failed: HTTP ${rNow2.status} ${rNow2.text}`);

    const nNow1 = normalizeRetrieve(rNow1.json as any);
    const nNow2 = normalizeRetrieve(rNow2.json as any);
    assertEq(JSON.stringify(nNow1), JSON.stringify(nNow2), "normalized retrieve bundles must be identical (now query; anchored by as_of)");

    // Use raw response ordering (ranked output). Normalization re-sorts by score/key, which can
    // hide intended ordering when base activation scores tie.
    const nowAtoms = (((rNow1.json as any)?.bundle?.atoms ?? []) as any[]).map((a) => String(a.canonical ?? ""));
    const idxNow = nowAtoms.indexOf(nowCanon);
    const idxPastInNow = nowAtoms.indexOf(pastCanon);
    assert(idxNow >= 0, `retrieve(now) missing expected canonical: "${nowCanon}"`);
    assert(idxPastInNow >= 0, `retrieve(now) missing expected canonical: "${pastCanon}"`);
    assert(idxNow < idxPastInNow, "when querying for current state, Now: must outrank Used to:");

    const edges = (nNow1.bundle.edges as any[]) ?? [];
    const wantEdgeSrc = `4:${pastCanon}`;
    const wantEdgeDst = `4:${nowCanon}`;
    assert(
      edges.some((e) => String(e.src ?? "") === wantEdgeSrc && Number(e.type) === 3 && String(e.dst ?? "") === wantEdgeDst),
      `missing expected CHANGED edge: ${wantEdgeSrc} -[3]-> ${wantEdgeDst}`
    );

    const rPast1 = await ctx.a.get("/v1/retrieve", { q: pastQuery, ...commonParams });
    assert(rPast1.ok, `retrieve(past:1) failed: HTTP ${rPast1.status} ${rPast1.text}`);
    const rPast2 = await ctx.a.get("/v1/retrieve", { q: pastQuery, ...commonParams });
    assert(rPast2.ok, `retrieve(past:2) failed: HTTP ${rPast2.status} ${rPast2.text}`);

    const nPast1 = normalizeRetrieve(rPast1.json as any);
    const nPast2 = normalizeRetrieve(rPast2.json as any);
    assertEq(JSON.stringify(nPast1), JSON.stringify(nPast2), "normalized retrieve bundles must be identical (past query; anchored by as_of)");

    const pastAtoms = (((rPast1.json as any)?.bundle?.atoms ?? []) as any[]).map((a) => String(a.canonical ?? ""));
    const idxPast = pastAtoms.indexOf(pastCanon);
    const idxNowInPast = pastAtoms.indexOf(nowCanon);
    assert(idxPast >= 0, `retrieve(past) missing expected canonical: "${pastCanon}"`);
    assert(idxNowInPast >= 0, `retrieve(past) missing expected canonical: "${nowCanon}"`);
    if (!(idxPast < idxNowInPast)) {
      const atomsRaw = (((rPast1.json as any)?.bundle?.atoms ?? []) as any[]).slice(0, 12).map((a) => ({
        canonical: String(a.canonical ?? ""),
        score: Number(a.score ?? 0),
      }));
      const fmt = (c: string) =>
        atomsRaw.find((a) => a.canonical === c)?.score !== undefined ? atomsRaw.find((a) => a.canonical === c)!.score.toFixed(6) : "n/a";
      throw new Error(
        `when querying for past state, Used to: must outrank Now: (q=${JSON.stringify(
          nPast1.q
        )}, past_idx=${idxPast}, now_idx=${idxNowInPast}, past_score=${fmt(
          pastCanon
        )}, now_score=${fmt(nowCanon)}). top_atoms=${JSON.stringify(atomsRaw)}`
      );
    }
  } finally {
    await conformanceForgetByCellId(ctx.a, cellId);
  }
}

async function testContradictionCluster(ctx: Ctx, fx: Extract<Fixture, { kind: "contradiction_cluster" }>) {
  const tok = fixtureToken(ctx.runId, fx.id);
  const objects = (Array.isArray(fx.objects) ? fx.objects : []).map((s) => String(s ?? "").replaceAll("{{TOK}}", tok).trim()).filter(Boolean);
  assert(objects.length >= 2, "contradiction_cluster requires at least 2 objects");

  const cellIds: string[] = [];
  for (const obj of objects) {
    cellIds.push(await conformanceIngest(ctx.a, `${tok} I like ${obj}.`));
    cellIds.push(await conformanceIngest(ctx.a, `${tok} I don't like ${obj}.`));
  }

  try {
    const asOf = new Date().toISOString();
    const r1 = await ctx.a.get("/v1/retrieve", {
      q: tok,
      limit: "50",
      as_of: asOf,
      include_evidence: "1",
      evidence_strategy: "per_atom_best",
      max_per_cell: "0",
    });
    assert(r1.ok, `retrieve(1) failed: HTTP ${r1.status} ${r1.text}`);
    const r2 = await ctx.a.get("/v1/retrieve", {
      q: tok,
      limit: "50",
      as_of: asOf,
      include_evidence: "1",
      evidence_strategy: "per_atom_best",
      max_per_cell: "0",
    });
    assert(r2.ok, `retrieve(2) failed: HTTP ${r2.status} ${r2.text}`);

    const n1 = normalizeRetrieve(r1.json as any);
    const n2 = normalizeRetrieve(r2.json as any);
    assertEq(JSON.stringify(n1), JSON.stringify(n2), "normalized retrieve bundles must be identical (anchored by as_of)");

    const canonicals = (n1.bundle.atoms as any[]).map((a) => String(a.canonical ?? ""));
    const mustInclude = (fx.expects.must_include_canonicals ?? []).map((s) => String(s ?? "").replaceAll("{{TOK}}", tok).trim()).filter(Boolean);
    const mustExclude = (fx.expects.must_exclude_canonicals ?? []).map((s) => String(s ?? "").replaceAll("{{TOK}}", tok).trim()).filter(Boolean);

    for (const c of mustInclude) assert(canonicals.includes(c), `retrieve must include canonical: "${c}"`);
    for (const c of mustExclude) assert(!canonicals.includes(c), `retrieve must not include canonical: "${c}"`);
  } finally {
    for (const id of cellIds) await conformanceForgetByCellId(ctx.a, id);
  }
}

async function testIdishSubstringCollision(ctx: Ctx, fx: Extract<Fixture, { kind: "idish_substring_collision" }>) {
  const tok = fixtureToken(ctx.runId, fx.id);
  const contentExact = String(fx.content_exact ?? "").replaceAll("{{TOK}}", tok);
  const contentSuper = String(fx.content_super ?? "").replaceAll("{{TOK}}", tok);

  const cellExact = await conformanceIngest(ctx.a, contentExact);
  const cellSuper = await conformanceIngest(ctx.a, contentSuper);

  try {
    const asOf = new Date().toISOString();
    const r = await ctx.a.get("/v1/retrieve", { q: tok, limit: "25", as_of: asOf, include_evidence: "1", evidence_strategy: "per_atom_best" });
    assert(r.ok, `retrieve failed: HTTP ${r.status} ${r.text}`);

    const n = normalizeRetrieve(r.json as any);
    const canonicals = (n.bundle.atoms as any[]).map((a) => String(a.canonical ?? ""));

    const wantIn = String(fx.expects.must_include_canonical ?? "").replaceAll("{{TOK}}", tok);
    const wantOut = String(fx.expects.must_exclude_canonical ?? "").replaceAll("{{TOK}}", tok);

    assert(canonicals.includes(wantIn), `retrieve must include canonical: "${wantIn}"`);
    assert(!canonicals.includes(wantOut), `retrieve must not include canonical: "${wantOut}"`);
  } finally {
    await conformanceForgetByCellId(ctx.a, cellExact);
    await conformanceForgetByCellId(ctx.a, cellSuper);
  }
}

async function testEvidenceRoundtrip(ctx: Ctx, fx: Extract<Fixture, { kind: "evidence_roundtrip" }>) {
  const tok = fixtureToken(ctx.runId, fx.id);
  const content = `${tok} ${fx.content}`;

  const cellId = await conformanceIngest(ctx.a, content);
  try {
    const retrieveRes = await ctx.a.get("/v1/retrieve", {
      q: tok,
      include_quotes: "1",
      evidence_strategy: "min_span",
      limit: "12",
    });
    assert(retrieveRes.ok, `retrieve failed: HTTP ${retrieveRes.status} ${retrieveRes.text}`);
    const evidence = (retrieveRes.json as any)?.evidence as any[] | undefined;
    assert(Array.isArray(evidence) && evidence.length > 0, "retrieve missing evidence[]");

    const lamEv = evidence.find((e) => String(e.text ?? "") === "LAM");
    assert(lamEv && lamEv.evidence_id, "expected an evidence quote of exactly \"LAM\"");

    const dec = await ctx.a.get("/v1/decode", { evidence_id: String(lamEv.evidence_id) });
    assert(dec.ok, `decode failed: HTTP ${dec.status} ${dec.text}`);
    assertEq(String((dec.json as any)?.text ?? ""), "LAM", "decode must return exact entity span bytes");
  } finally {
    await conformanceForgetByCellId(ctx.a, cellId);
  }
}

async function testContextRoundtrip(ctx: Ctx, fx: Extract<Fixture, { kind: "context_roundtrip" }>) {
  const tok = fixtureToken(ctx.runId, fx.id);
  const content = `${tok} ${fx.content}`;
  const cellId = await conformanceIngest(ctx.a, content);

  try {
    const qRaw = typeof fx.query === "string" && fx.query.trim() ? fx.query.trim() : "{{TOK}}";
    const q = qRaw.replaceAll("{{TOK}}", tok);

    const ctxRes = await ctx.a.post("/v1/context", { q, limit: 10, max_chars: 4000 });
    assert(ctxRes.ok, `context failed: HTTP ${ctxRes.status} ${ctxRes.text}`);
    const passages = (ctxRes.json as any)?.passages as any[] | undefined;
    assert(Array.isArray(passages) && passages.length > 0, "context missing passages[]");

    const p0 = passages[0] ?? null;
    assert(p0 && p0.passage_id, "context passage missing passage_id");
    assertEq(String(p0.cell_id ?? ""), cellId, "context passage cell_id should match the ingested cell_id");

    const wantText = String(p0.text ?? "");
    assert(wantText, "context passage missing text");
    const wantSha = String(p0.sha256 ?? "").toLowerCase();
    assert(/^[0-9a-f]{64}$/.test(wantSha), "context passage sha256 must be 64 hex chars");

    const dec = await ctx.a.get("/v1/decode", { passage_id: String(p0.passage_id) });
    assert(dec.ok, `decode failed: HTTP ${dec.status} ${dec.text}`);
    const gotText = String((dec.json as any)?.text ?? "");
    assertEq(gotText, wantText, "decode text must match context passage text");

    const gotSha = crypto.createHash("sha256").update(gotText, "utf8").digest("hex");
    assertEq(gotSha, wantSha, "decode text sha256 must match context passage sha256");
  } finally {
    await conformanceForgetByCellId(ctx.a, cellId);
  }
}

async function testPdfTextEvidence(ctx: Ctx, fx: Extract<Fixture, { kind: "pdf_text_evidence" }>) {
  const tok = fixtureToken(ctx.runId, fx.id);

  const assetPath = path.resolve(process.cwd(), fx.asset_b64_path);
  const b64 = (await fs.readFile(assetPath, "utf8")).trim();
  assert(b64 && !/\s/.test(b64), "asset_b64_path must contain a single-line base64 string");

  const cellId = await conformanceIngestB64(ctx.a, {
    contentType: fx.content_type,
    contentB64: b64,
    // Use a unique claim as a stable seed so the retrieve query is isolated to this fixture.
    claims: [{ type: "FACT", canonical: tok, confidence: 0.8 }],
  });

  try {
    const retrieveRes = await ctx.a.get("/v1/retrieve", {
      q: fx.query,
      include_quotes: "1",
      evidence_strategy: "per_atom_best",
      limit: "50",
    });
    assert(retrieveRes.ok, `retrieve failed: HTTP ${retrieveRes.status} ${retrieveRes.text}`);

    const rjson = retrieveRes.json as any;
    const atoms = Array.isArray(rjson?.bundle?.atoms) ? (rjson.bundle.atoms as any[]) : [];
    const evidence = Array.isArray(rjson?.evidence) ? (rjson.evidence as any[]) : [];

    const atom = atoms.find((a) => String(a?.canonical ?? "") === fx.expects.canonical) ?? null;
    assert(atom && atom.atom_id, `retrieve missing expected canonical atom: "${fx.expects.canonical}"`);

    const ev = evidence.find((e) => String(e?.atom_id ?? "") === String(atom.atom_id)) ?? null;
    assert(ev && ev.evidence_id, `retrieve missing evidence for canonical atom: "${fx.expects.canonical}"`);

    assertEq(String(ev.cell_id ?? ""), cellId, "evidence cell_id should match the ingested PDF cell_id");
    assertEq(String(ev.encoding ?? ""), "utf8", "PDF extracted-text evidence must decode as utf8");
    assert(typeof ev.text === "string", "PDF extracted-text evidence must include text");
    assert(String(ev.text ?? "").includes(fx.expects.quote_substring), `missing expected quote substring: "${fx.expects.quote_substring}"`);
    assertEq(String(ev.span_type ?? ""), fx.expects.span_type, `expected span_type=${fx.expects.span_type}`);
    assert(String(ev.transform ?? "").startsWith(fx.expects.transform_prefix), `expected transform prefix: ${fx.expects.transform_prefix}`);

    const dec = await ctx.a.get("/v1/decode", { evidence_id: String(ev.evidence_id) });
    assert(dec.ok, `decode failed: HTTP ${dec.status} ${dec.text}`);
    assertEq(String((dec.json as any)?.text ?? ""), String(ev.text ?? ""), "decode text must match retrieve quote text");
    assertEq(String((dec.json as any)?.span_type ?? ""), fx.expects.span_type, "decode must preserve span_type");
    assert(String((dec.json as any)?.transform ?? "").startsWith(fx.expects.transform_prefix), "decode must preserve transform");
  } finally {
    await conformanceForgetByCellId(ctx.a, cellId);
  }
}

async function testUpstreamTextViewClaimEvidence(ctx: Ctx, fx: Extract<Fixture, { kind: "upstream_text_view_claim_evidence" }>) {
  const tok = fixtureToken(ctx.runId, fx.id);

  const assetPath = path.resolve(process.cwd(), fx.asset_b64_path);
  const b64 = (await fs.readFile(assetPath, "utf8")).trim();
  assert(b64 && !/\s/.test(b64), "asset_b64_path must contain a single-line base64 string");

  const viewText = String(fx.text_template ?? "").replaceAll("{{TOK}}", tok);
  assert(viewText.startsWith(tok), "text_template must start with {{TOK}} so evidence spans are deterministic");

  const cellId = await conformanceIngestB64(ctx.a, {
    contentType: fx.content_type,
    contentB64: b64,
    textViews: [{ transform: fx.text_transform, text: viewText }],
    claims: [
      {
        type: "FACT",
        canonical: tok,
        confidence: 0.8,
        evidence: {
          span_type: "text",
          transform: fx.text_transform,
          start_pos: 0,
          end_pos: tok.length,
          quote_budget: 512,
        },
      },
    ],
  });

  try {
    const retrieveRes = await ctx.a.get("/v1/retrieve", {
      q: tok,
      include_quotes: "1",
      evidence_strategy: "per_atom_best",
      limit: "50",
    });
    assert(retrieveRes.ok, `retrieve failed: HTTP ${retrieveRes.status} ${retrieveRes.text}`);

    const rjson = retrieveRes.json as any;
    const atoms = Array.isArray(rjson?.bundle?.atoms) ? (rjson.bundle.atoms as any[]) : [];
    const evidence = Array.isArray(rjson?.evidence) ? (rjson.evidence as any[]) : [];

    const atom = atoms.find((a) => String(a?.canonical ?? "") === tok && Number(a?.type ?? 0) === 4) ?? null;
    assert(atom && atom.atom_id, `retrieve missing expected FACT atom canonical: \"${tok}\"`);

    const ev = evidence.find((e) => String(e?.atom_id ?? "") === String(atom.atom_id)) ?? null;
    assert(ev && ev.evidence_id, `retrieve missing evidence for canonical atom: \"${tok}\"`);

    assertEq(String(ev.cell_id ?? ""), cellId, "evidence cell_id should match the ingested cell_id");
    assertEq(String(ev.encoding ?? ""), "utf8", "upstream text-view evidence must decode as utf8");
    assertEq(String(ev.text ?? ""), tok, "evidence quote must equal the claimed token");
    assertEq(String(ev.span_type ?? ""), fx.expects.span_type, `expected span_type=${fx.expects.span_type}`);
    assert(String(ev.transform ?? "").startsWith(fx.expects.transform_prefix), `expected transform prefix: ${fx.expects.transform_prefix}`);

    const dec = await ctx.a.get("/v1/decode", { evidence_id: String(ev.evidence_id) });
    assert(dec.ok, `decode failed: HTTP ${dec.status} ${dec.text}`);
    assertEq(String((dec.json as any)?.text ?? ""), tok, "decode text must match retrieve quote text");
    assertEq(String((dec.json as any)?.span_type ?? ""), fx.expects.span_type, "decode must preserve span_type");
    assert(String((dec.json as any)?.transform ?? "").startsWith(fx.expects.transform_prefix), "decode must preserve transform");
  } finally {
    await conformanceForgetByCellId(ctx.a, cellId);
  }
}

async function testRetrieveDeterminism(ctx: Ctx, fx: Extract<Fixture, { kind: "retrieve_determinism" }>) {
  const tok = fixtureToken(ctx.runId, fx.id);

  const obj = tok;
  const content1 = `${tok} ${fx.content_1.replaceAll("{{OBJ}}", obj)}`;
  const content2 = `${tok} ${fx.content_2.replaceAll("{{OBJ}}", obj)}`;

  const cellId1 = await conformanceIngest(ctx.a, content1);
  const cellId2 = await conformanceIngest(ctx.a, content2);

  try {
    const asOf = new Date().toISOString();
    const q = tok;

    const r1 = await ctx.a.get("/v1/retrieve", { q, limit: "20", as_of: asOf, include_evidence: "1", evidence_strategy: "per_atom_best" });
    assert(r1.ok, `retrieve(1) failed: HTTP ${r1.status} ${r1.text}`);

    const r2 = await ctx.a.get("/v1/retrieve", { q, limit: "20", as_of: asOf, include_evidence: "1", evidence_strategy: "per_atom_best" });
    assert(r2.ok, `retrieve(2) failed: HTTP ${r2.status} ${r2.text}`);

    const n1 = normalizeRetrieve(r1.json as any);
    const n2 = normalizeRetrieve(r2.json as any);

    assertEq(JSON.stringify(n1), JSON.stringify(n2), "normalized retrieve bundles must be identical");

    const wantIn = fx.expects.must_include_canonical.replaceAll("{{OBJ}}", obj);
    const wantOut = fx.expects.must_exclude_canonical.replaceAll("{{OBJ}}", obj);

    const canonicals = (n1.bundle.atoms as any[]).map((a) => String(a.canonical ?? ""));
    assert(canonicals.includes(wantIn), `retrieve must include canonical: "${wantIn}"`);
    assert(!canonicals.includes(wantOut), `retrieve must not include canonical: "${wantOut}"`);
  } finally {
    // cell_id is content-addressed per document; forget both
    await conformanceForgetByCellId(ctx.a, cellId1);
    await conformanceForgetByCellId(ctx.a, cellId2);
  }
}

async function testForgetRetention(ctx: Ctx, fx: Extract<Fixture, { kind: "forget_retention" }>) {
  // Retention endpoints
  const before = await ctx.a.get("/v1/retention");
  assert(before.ok, `GET /retention failed: HTTP ${before.status} ${before.text}`);
  assert(typeof (before.json as any)?.retention_days === "number", "retention_days must be a number");
  assert(typeof (before.json as any)?.delete_mode === "string", "delete_mode must be a string");

  const set = await ctx.a.post("/v1/retention", { retention_days: 7, delete_mode: "tombstone" });
  assert(set.ok, `POST /retention failed: HTTP ${set.status} ${set.text}`);

  const after = await ctx.a.get("/v1/retention");
  assert(after.ok, `GET /retention failed: HTTP ${after.status} ${after.text}`);
  assertEq((after.json as any)?.retention_days, 7, "retention_days should roundtrip");
  assertEq((after.json as any)?.delete_mode, "tombstone", "delete_mode should roundtrip");

  const tok = fixtureToken(ctx.runId, fx.id);
  const content = `${tok} ${fx.content}`;
  const cellId = await conformanceIngest(ctx.a, content);

  try {
    const recallBefore = await ctx.a.get("/v1/recall", { q: tok, limit: "20" });
    assert(recallBefore.ok, `recall(before) failed: HTTP ${recallBefore.status} ${recallBefore.text}`);
    assert(((recallBefore.json as any)?.results?.length ?? 0) > 0, "recall(before) should return results");

    await conformanceForgetByCellId(ctx.a, cellId);

    const recallAfter = await ctx.a.get("/v1/recall", { q: tok, limit: "20" });
    assert(recallAfter.ok, `recall(after) failed: HTTP ${recallAfter.status} ${recallAfter.text}`);
    assertEq(((recallAfter.json as any)?.results?.length ?? 0) as any, 0 as any, "recall(after) must be empty after forget");
  } finally {
    // Best-effort: reset retention policy
    await ctx.a.post("/v1/retention", { retention_days: 0, delete_mode: "hard" });
  }
}

async function testScopeSelector(ctx: Ctx, fx: Extract<Fixture, { kind: "scope_selector" }>) {
  const http = ctx.selector;
  if (!http) {
    return { skipped: true as const, reason: "missing API_TOKEN_SELECTOR" };
  }

  // Probe if selector mode is enabled (if disabled, passing scope_* should be rejected as 400).
  const probe = await http.get("/v1/recall", { q: "probe", ...fx.allowed });
  if (probe.status === 400) {
    // selector not enabled on server; treat as skip
    return { skipped: true as const, reason: "scope selector mode not enabled (server returned 400)" };
  }

  assert(probe.ok, `scope selector allowed request failed: HTTP ${probe.status} ${probe.text}`);

  const bad = await http.get("/v1/recall", { q: "probe", ...fx.forbidden });
  assertEq(bad.status, 403, "scope selector must forbid broadening outside key scope (HTTP 403)");

  return { skipped: false as const };
}

async function main() {
  const cli = parseCli(process.argv.slice(2));
  const baseUrl = (process.env.BASE_URL || process.env.LAM_BASE_URL || "http://127.0.0.1:8080").trim();
  const tokenA = (process.env.API_TOKEN_A || process.env.TOKEN || process.env.LAM_TOKEN || "").trim();
  const tokenB = (process.env.API_TOKEN_B || "").trim();
  const tokenSel = (process.env.API_TOKEN_SELECTOR || "").trim();

  assert(tokenA, "Missing API_TOKEN_A (or TOKEN/LAM_TOKEN)");
  assert(tokenB, "Missing API_TOKEN_B");

  const runId = crypto.randomBytes(4).toString("hex");

  const ctx: Ctx = {
    baseUrl,
    a: new LamHttp(baseUrl, tokenA),
    b: new LamHttp(baseUrl, tokenB),
    selector: tokenSel ? new LamHttp(baseUrl, tokenSel) : undefined,
    runId,
  };

  const fixtures = (await loadFixtures()).filter((f) => (cli.only.length === 0 ? true : cli.only.some((x) => f.id.includes(x))));

  const results: Array<{ id: string; kind: string; ok: boolean; skipped: boolean; skip_reason?: string; error?: string }> = [];

  for (const f of fixtures) {
    try {
      if (f.kind === "basic_text") await testBasicText(ctx, f);
      else if (f.kind === "scope_isolation") await testScopeIsolation(ctx, f);
      else if (f.kind === "dedupe_idempotent") await testDedupeIdempotent(ctx, f);
      else if (f.kind === "evidence_roundtrip") await testEvidenceRoundtrip(ctx, f);
      else if (f.kind === "context_roundtrip") await testContextRoundtrip(ctx, f);
      else if (f.kind === "state_over_time") await testStateOverTime(ctx, f);
      else if (f.kind === "contradiction_cluster") await testContradictionCluster(ctx, f);
      else if (f.kind === "idish_substring_collision") await testIdishSubstringCollision(ctx, f);
      else if (f.kind === "pdf_text_evidence") await testPdfTextEvidence(ctx, f);
      else if (f.kind === "upstream_text_view_claim_evidence") await testUpstreamTextViewClaimEvidence(ctx, f);
      else if (f.kind === "retrieve_determinism") await testRetrieveDeterminism(ctx, f);
      else if (f.kind === "forget_retention") await testForgetRetention(ctx, f);
      else if (f.kind === "scope_selector") {
        const out = await testScopeSelector(ctx, f);
        results.push({ id: f.id, kind: f.kind, ok: true, skipped: out?.skipped === true, skip_reason: out?.reason });
        continue;
      } else {
        throw new Error(`Unknown fixture kind: ${(f as any).kind}`);
      }

      results.push({ id: f.id, kind: f.kind, ok: true, skipped: false });
    } catch (err) {
      const e = err instanceof AssertionError ? err : err;
      results.push({ id: f.id, kind: (f as any).kind ?? "unknown", ok: false, skipped: false, error: fail("", e).error });
    }
  }

  const passed = results.filter((r) => r.ok && !r.skipped).length;
  const skipped = results.filter((r) => r.ok && r.skipped).length;
  const failed = results.filter((r) => !r.ok).length;

  for (const r of results) {
    const name = `${r.id} (${r.kind})`;
    if (r.ok && r.skipped) {
      process.stdout.write(`SKIP ${name}${r.skip_reason ? `: ${r.skip_reason}` : ""}\n`);
    } else if (r.ok) {
      process.stdout.write(`PASS ${name}\n`);
    } else {
      process.stdout.write(`FAIL ${name}: ${r.error}\n`);
    }
  }

  process.stdout.write(`\nSummary: pass=${passed} skip=${skipped} fail=${failed}\n`);

  if (cli.outPath) {
    const outAbs = path.resolve(process.cwd(), cli.outPath);
    await fs.mkdir(path.dirname(outAbs), { recursive: true });
    const report = {
      ts: new Date().toISOString(),
      base_url: baseUrl,
      run_id: runId,
      summary: { pass: passed, skip: skipped, fail: failed },
      results,
    };
    await fs.writeFile(outAbs, JSON.stringify(report, null, 2) + "\n", "utf8");
    process.stdout.write(`Wrote ${outAbs}\n`);
  }

  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err?.message ?? err);
  process.exit(1);
});
