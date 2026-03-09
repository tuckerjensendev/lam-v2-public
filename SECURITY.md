# LAM™ Security (v0.1)

This document describes LAM™’s security model, threat assumptions, and the “boring proofs” expected by serious deployments (enterprise/gov).

This is not a certification. Treat it as a living threat model + operational checklist.

## Reporting vulnerabilities

If you believe you’ve found a security vulnerability, please **do not** open a public issue.

Email:
- `support@lam-protocol.com` (subject: “Security: <short description>”)

Last verified (local): **2026-02-03**
- `npm run security:conformance:local`
- `npm run backup:restore:drill:local`

---

## Security model (what LAM™ guarantees)

1) **Scope-locked API**
- All `/v1/*` routes derive scope only from the bearer token (tenant + scope_user/org/project + namespace).
- Requests reject client-supplied scope fields (scope-smuggling) by default.

2) **Lossless storage with authenticated encryption**
- Cells are encrypted with AES-256-GCM (tamper-detecting, fail-closed on wrong keys).
- Cell ciphertext is bound to `(tenant_id, cell_id)` via AAD to prevent blob swapping across tenants/cells.

3) **Proof-first auditing**
- Retrieval returns `evidence_id` pointers and bounded quotes.
- `/v1/decode?evidence_id=...` is scope-locked and enforces `quote_budget`.
- Debug decode by `cell_id` is disabled by default (`LAM_ALLOW_DECODE_CELL_ID` must be explicitly enabled).

4) **Deterministic key versioning**
- Master key version and tenant key version are embedded in the blob header and stored in the `cells` table.
- Master key provider supplies a versioned keyring; rotation is append-only.

---

## Threat model

### Assets

High-value secrets:
- **Master keys** (decrypt tenant keys → decrypt all cell blobs for the environment)
- **Per-tenant ID root keys** (`tenant_secrets.id_root_key_wrapped` plaintext; used for stable `cell_id` + keyed fingerprints)

Sensitive data:
- **Cell plaintext** (the raw user/proprietary content)
- **Extracted text views** (`cell_text`) for non-text cells
- **Atoms/edges/evidence** (may contain sensitive facts derived from plaintext)
- **API tokens** (bearer credentials)

### Trust boundaries

- LAM process memory: contains decrypted master keys (and derived keys) at runtime.
- Postgres: stores ciphertext + graph + evidence + key versions + wrapped tenant secrets.
- Cell blob store: filesystem / Postgres / object storage.
- Clients: hold bearer tokens and can request `/v1/*` within their scope.
- Optional: external extractors / embedders (called as subprocesses).

### Assumptions

- The LAM binary/container is trusted (supply chain is handled by your org).
- The host OS and runtime are patched and monitored.
- Network perimeter controls exist (TLS termination, firewalling, private networking for Postgres).
- Operators follow key rotation and backup/restore discipline.

### Out of scope (explicitly)

- Kernel/host compromise: if an attacker owns the host, they can likely exfiltrate in-memory keys.
- Physical compromise without disk encryption.
- Side-channel attacks on shared hardware.

### Threats & mitigations (summary)

**DB compromise (read-only):**
- Attacker sees ciphertext blobs + graph/evidence metadata.
- Mitigation: master keys are not in DB; AES-GCM fails closed; scope-locked decode prevents tenant cross-read via API.

**Cell blob store compromise (read-only):**
- Same as DB compromise; ciphertext only.
- Mitigation: keys live outside the store; AAD prevents swapping ciphertext between cells/tenants.

**Bearer token leak:**
- Attacker can read/write within that token’s scope.
- Mitigation: rotate/revoke API keys; separate tokens by scope; use short-lived tokens if you can; monitor audit logs.

**Master key leak:**
- Worst case: attacker can decrypt all tenant secrets and blobs for that environment.
- Mitigation: use KMS/HSM provider, strict IAM, key policies, audit trails, rotation SOPs, and incident response drills.

**Misconfiguration (fail open):**
- Debug endpoints or admin endpoints accidentally exposed.
- Mitigation: fail-closed defaults + conformance checks + documented hardening checklist.

---

## Master key providers

LAM supports two master key provider modes:

### 1) `env` provider (dev / air-gapped)

Set either:
- `LAM_MASTER_KEY_B64` (single key) **or**
- `LAM_MASTER_KEYS_B64` (comma-separated base64 keys; versions are 1..N by position; append-only)

Optionally:
- `LAM_MASTER_KEY_ACTIVE_VERSION` (defaults to latest)

### 2) `aws-kms` provider (enterprise default)

Set:
- `LAM_MASTER_KEY_PROVIDER=aws-kms`
- `LAM_MASTER_KEYS_KMS_B64` (comma-separated **ciphertext blobs**, base64; versions are 1..N by position; append-only)

Optionally (recommended):
- `LAM_KMS_REGION` (or `AWS_REGION`)
- `LAM_KMS_ENCRYPTION_CONTEXT_JSON` (EncryptionContext JSON object)

Runtime behavior:
- On process start, LAM decrypts the ciphertext keys once and caches the plaintext keys in memory.
- LAM does **not** call KMS for each request.

---

## Rotation SOP (master keys)

### Env provider rotation (append-only)

1) Generate a new key: `NEW_KEY="$(npm run -s master:key:create)"`
2) Append it to `LAM_MASTER_KEYS_B64` (do not remove old keys yet).
3) Set `LAM_MASTER_KEY_ACTIVE_VERSION` to the new version number.
4) Restart LAM.
5) Verify coverage: `npm run master:key:check`
6) Optional hardening: `npm run master:key:rewrap` (so `tenant_secrets` no longer depends on old master key versions).

### AWS KMS provider rotation (append-only)

1) Generate a new encrypted key: `NEW_CT="$(npm run -s master:key:create:kms -- --key-id "$LAM_KMS_KEY_ID")"`
2) Append it to `LAM_MASTER_KEYS_KMS_B64` (do not remove old ciphertexts yet).
3) Set `LAM_MASTER_KEY_ACTIVE_VERSION` to the new version number.
4) Restart LAM.
5) Verify coverage: `npm run master:key:check`
6) Optional hardening: `npm run master:key:rewrap`

---

## Backup/restore drill (proof that `/decode` survives)

Serious deployments should run and log restore drills (not just backups).

This repo includes a local drill script that:
- ingests a cell
- captures an `evidence_id` and its decoded quote
- backs up DB + cell storage
- restores into a wiped DB
- verifies `/v1/decode?evidence_id=...` returns the same quote post-restore

Run:
```bash
node scripts/backup-restore-drill-local.js
```

Notes:
- If you use `LAM_CELL_STORE=postgres`, the DB backup contains the encrypted blobs (`cell_blobs`).
- If you use filesystem/object storage, you must back up and restore the blob store *as well as* Postgres.
