# Appendix (non-normative): LAM for embodied agents

This appendix is **non-normative**. It does not change the Certified v0.1 requirements; it documents conventions that make “LAM-compatible” mean something for **robots / embodied agents**.

The goal is not “a robot that remembers more.” It’s a robot whose memory has:
- **hard scope boundaries** (who can see what)
- **proof-first recall** (every claim points to evidence spans)
- **deletion/retention correctness** (you can forget and verify it’s gone)
- **regression fixtures** that are painful to fake

## 1) Recommended atom templates (using existing primitives)

LAM’s atom types are intentionally small: `ENTITY`, `EVENT`, `PREFERENCE`, `FACT`, `PROCEDURE`.

For embodied agents, treat them as the “ABI” and standardize the *canonical* strings you emit from your extractor stack.

### Episodic events (`EVENT`)

Use for “what happened” at a moment in time:

- Canonical template (recommended):
  - `OBS: <ts> <actor> <verb> <object> @ <place>`
  - Example: `OBS: 2026-02-03T12:05:14Z robot placed mug @ kitchen counter`

### Routines (`PROCEDURE`)

Use for repeatable sequences (often safety-critical):

- Canonical template:
  - `Routine: <name>. Steps: 1) ... 2) ...`
  - Example: `Routine: dishwasher. Steps: 1) scrape plates 2) load rack 3) add pod 4) start`

### Preferences (`PREFERENCE`)

Use for stable user preferences that should generalize:

- Canonical template:
  - `Pref: <subject> prefers <thing>`
  - Example: `Pref: tucker prefers blunt answers`

### Household rules / safety constraints (`FACT`)

Use for “must” / “must not” constraints and policies:

- Canonical template:
  - `Rule: <scope> must|must not <action>`
  - Example: `Rule: kitchen robot must not touch stove knobs`

### Entities (`ENTITY`)

Use for stable identity anchors:

- Prefer extractor-provided `entity.kind` + stable IDs (CRM ID, device ID, resident ID) when available.
- Store aliases for name variants (“Mom”, “Mother”, “Alice”).

## 2) Observed vs reported (and inferred)

Embodied systems must distinguish *sensor observations* from *human reports* and *model inferences*.

Without changing the API schema, you can do this today by adopting a canonical prefix convention:

- `OBS:` = directly observed (sensor / perception)
- `REP:` = reported by a user / operator
- `INF:` = inferred by a model (treat as lower-trust unless confirmed)

Think of this as an `observed_vs_reported` provenance flag in your extractor/agent claim metadata, even if you encode it into canonical strings for v0.1 compatibility.

This makes it easy to filter at retrieval time (by query intent or by namespace partitioning).

## 3) Multi-user scoping patterns (household / individual / guest)

LAM scope is token-derived (fail-closed by default). For embodied agents, a practical mapping is:

- `scope_org` = household/site/deployment (shared environment boundary)
- `scope_user` = individual resident/operator identity
- `scope_project` = device/robot ID (optional; isolates multi-robot fleets)
- `namespace` = memory class (e.g. `private`, `household`, `guest`, `safety`)

Example patterns:

- **Private memory:** key minted to `scope_user=alice`, `namespace=private`
- **Household/shared memory:** key minted to `scope_org=home-123`, `namespace=household` (and `scope_user=*` if using selector mode)
- **Guest mode:** key minted to `scope_user=guest:<session>`, `namespace=guest` with short retention (see below)

## 4) Robot memory safety profile (recommended defaults)

This is a “buyer-grade” posture: conservative defaults, explicit knobs, and auditable behavior.

### Retention windows

Suggested starting point (tune per domain):

- `namespace=safety`: long-lived (or “manual delete only”), because it’s policy + compliance
- `namespace=private`: user-controlled; default “keep until forgotten”
- `namespace=household`: moderate default retention (e.g. 30–90 days)
- `namespace=guest`: short retention (e.g. 0–7 days) + **hard delete** on expiry
- high-volume raw observations (video/audio transcripts): short retention unless explicitly promoted

### Guest mode behavior

Minimum expectations:

- Guest-scoped keys MUST NOT be able to retrieve private/household memory.
- Guest memory SHOULD be time-limited by default and easy to “forget all”.

### Private-memory rules

Minimum expectations:

- Private memory retrieval should always be scoped to the individual user.
- Admin/operator tooling must have explicit audit trails for access and deletion operations.

### Operator audit/export expectations

For embodied systems, reviewers will ask:

- “Where did that come from?” → `evidence_id` + `/v1/decode`
- “Can we delete it?” → `/v1/forget` + verify it’s unretrievable
- “Can we export it?” → scope-limited export with evidence pointers and retention metadata

## 5) “Painful to fake” regression suite (recommended)

If you want “LAM-compatible” to mean something, the suite matters more than the code:

- scope boundary tests (cross-scope recall/retrieve/decode must fail)
- deletion/retention invariants (forget must actually make data unretrievable)
- evidence correctness (decoded quote contains the asserted value)
- time/recency/contradiction fixtures (latest wins; no cross-contamination; deterministic anchoring)
