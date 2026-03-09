# LAM Conformance Suite (LAM Certified v0.1)

This folder defines a **protocol-level conformance suite** for LAM.

The goal is that **independent implementations** (different languages, different storage backends) can run the same suite against a running server and get the same results.

## How to run

Run against an already-running LAM server:

```bash
BASE_URL="http://127.0.0.1:8080" \
API_TOKEN_A="..." \
API_TOKEN_B="..." \
npm run conformance
```

Local one-command harness (starts DB + migrates + starts server + runs suite):

```bash
npm run conformance:local
```

## Required environment variables

- `BASE_URL` (optional; default `http://127.0.0.1:8080`)
- `API_TOKEN_A` (required): token for tenant `T`, scope `A`
- `API_TOKEN_B` (required): token for tenant `T`, scope `B` (must not be able to read scope `A`)

### Token requirements (minimum)

For the core suite:
- `API_TOKEN_A` and `API_TOKEN_B` MUST be for the **same tenant** (so we’re testing scope isolation, not tenant isolation).
- `API_TOKEN_A` and `API_TOKEN_B` MUST differ by at least one scope field (`scope_user`, `scope_org`, `scope_project`, or `namespace`) so cross-scope reads are impossible.

Recommended for local dev:
- Token A: `scope_user="u1"`, `namespace="conformance"`
- Token B: `scope_user="u2"`, `namespace="conformance"`

## Normative behaviors (MUST for Certified v0.1)

### Async enrichment (normative v0.1)

LAM may perform extraction/atomization asynchronously. In that case:
- `POST /v1/ingest` MUST store the cell and enqueue enrichment (fast path).
- Implementations MUST provide a scope-locked status endpoint:
  - `GET /v1/enrichment/status?cell_id=...`
  - Returns `status` in `queued | running | done | failed` and `last_error` when `failed`.
- Conformance expectations for `/recall`, `/retrieve`, and `/decode` apply **after** enrichment reaches `status="done"`.

### Evidence protocol (normative v0.1)

LAM’s “proof layer” is the evidence protocol: atoms can be traced back to **bounded excerpts** via `evidence_id`.

Evidence rows are defined by:
- `cell_id`: the immutable, encrypted source cell (bytes)
- `span_type`: what representation `start_pos/end_pos` point into
- `transform`: how that representation was derived (when applicable)

#### Evidence spans

`start_pos` and `end_pos` are always **UTF-8 byte offsets** into the representation described by `span_type`.

Allowed `span_type` values for v0.1:

- `span_type="bytes"`:
  - Offsets are into the **original cell plaintext bytes** (after decrypt + codec decode).
  - `transform` MUST be `none` (or `identity`).
  - Decoding may be human-readable **only if** the cell `content_type` is text-like.

- `span_type="text"`:
  - Offsets are into a **derived UTF-8 text view** of the cell.
  - Decoding MUST be human-readable (`encoding="utf8"`).
  - `transform` identifies which deterministic text view produced the offsets.
    - Versioned + content-addressed identifiers are RECOMMENDED, e.g. `pdf_text:v1:sha256=<hex>`.

#### Quote budgets

Evidence includes `quote_budget` (bytes). When decoding (via `/retrieve?include_quotes=1` or `/decode?evidence_id=...`), implementations MUST:
- Clamp `end_pos` to `min(end_pos, start_pos + quote_budget)`
- Return `truncated=1` iff clamping occurred

#### Decoding rules

For `/v1/retrieve?include_quotes=1`, each returned `evidence[]` entry MUST include:
- `evidence_id`, `atom_id`, `cell_id`, `span_type`, `start_pos`, `end_pos`, `transform`, `quote_budget`, `truncated`
- `encoding` and exactly one of:
  - `text` (when `encoding="utf8"`)
  - `data_b64` (when `encoding="base64"`)

For `/v1/decode?evidence_id=...`, responses MUST:
- Be scope-locked (a token that cannot read the atom’s scope MUST receive `404`)
- Apply the same quote budget truncation rules
- Return the same excerpt bytes as `/retrieve?include_quotes=1` for that `evidence_id`

### A) Lossless round-trip (proof)

- After `POST /v1/ingest` and enrichment completion (`GET /v1/enrichment/status?... -> status="done"`), a subsequent `GET /v1/retrieve?include_quotes=1` MUST return bounded decoded excerpts.
- `GET /v1/decode?evidence_id=...` MUST return the exact same bytes (subject to the stored `quote_budget` truncation rules).

### B) Canonical dedupe / idempotent-ish ingest

- Re-ingesting identical content MUST return the same `cell_id` (content-addressed).
- Canonical atoms MUST dedupe (no duplicate `(type, canonical)` within the same scope).

### C) Scope isolation

- Data ingested under token A MUST NOT be visible to token B via `/recall`, `/retrieve`, or `/decode` (evidence path).

### D) Determinism

- Two identical `/retrieve` calls against identical DB state and identical params MUST return identical normalized bundles.
- If `as_of` is supported, it MUST deterministically anchor decay calculations.

### E) Governance

- `POST /v1/forget` MUST remove scoped evidence and make content un-recallable/un-retrievable for that scope.
- `GET /v1/retention` and `POST /v1/retention` MUST exist and behave consistently.

### F) Identifier collision safety

For query “needles” that look like identifiers (mixed letters+digits such as `MantisX1`, `v10`, ticket IDs, etc.), implementations MUST avoid substring collisions where the needle matches a superstring token (e.g. `X1` must not match `X16`).

This is a real-world correctness issue (versions, ticket IDs) and is enforced by the conformance fixture:
- `conformance/fixtures/045_idish_substring_collision.json:1`

### G) State over time (temporal intent)

When the ingested text expresses a state transition (“used to … now …”), implementations MUST:
- represent both sides as explicit atoms (e.g., `Used to: ...` and `Now: ...`)
- link them with a `CHANGED` edge
- bias retrieval appropriately for temporal intent:
  - queries containing “now/current/latest” MUST prefer `Now:` atoms over `Used to:`
  - queries containing “before/previously/used to” MUST prefer `Used to:` atoms over `Now:`

This is enforced by the conformance fixture:
- `conformance/fixtures/041_state_over_time.json:1`

### H) Contradiction isolation (no cross-contamination)

If the implementation represents explicit contradictions (v0.1 does this for common preference polarity pairs like `I like X` vs `I don't like X`), retrieval MUST NOT return both sides of a supported contradiction pair in the same normalized result set.

This is enforced by the conformance fixture:
- `conformance/fixtures/042_contradiction_cluster.json:1`

## Optional suite: Scope selector mode

If the implementation supports scope selector mode (`LAM_ALLOW_SCOPE_SELECTOR=1`), you can also run the selector fixture by providing:

- `API_TOKEN_SELECTOR` minted with patterns:
  - `scope_user="user:*"`
  - `scope_org="org:*"`
  - `scope_project="proj:*"`
  - `namespace="conformance*"`

This verifies selector mode is **narrowing-only** (no scope escalation).

## Non-normative appendices

- Embodied agents + robot memory safety profile: `conformance/appendices/embodied_agents.md:1`
