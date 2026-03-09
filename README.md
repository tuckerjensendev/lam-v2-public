# LAM™ — Protocol, Conformance, and Public SDKs (v0.1)

LAM™ (Lossless Associative Memory) is a scope-locked HTTP memory API with **proof-carrying citations**:
- **lossless**: original user inputs are stored as encrypted “cells” and are retrievable exactly
- **associative**: a compact graph of “atoms” enables human-like recall
- **auditable**: atoms can point back to exact byte spans via `evidence_id` → `/v1/decode`

This repository is the **public-facing** LAM v0.1 surface area:
- the protocol contract (`conformance/spec.md`)
- the protocol-level conformance runner (`npm run conformance`)
- tiny “official” client SDKs (TypeScript + Python)
- a one-command local conformance harness (Docker; `npm run conformance:local`)

If you’re looking for a 5-minute demo bundle, use: `lam-prove-it` (public)  
If you want enterprise/self-host support, email: `support@lam-protocol.com`

## Links

- Docs: https://www.lam-protocol.com/docs/
- Demo (Docker Compose): https://github.com/tuckerjensendev/lam-prove-it
- Hosted API base: https://api.lam-protocol.com
- Hosted Console: https://console.lam-protocol.com/console/

## Quickstart (local demo)

```bash
git clone https://github.com/tuckerjensendev/lam-prove-it.git
cd lam-prove-it
make demo
```

No `make`? Run:

```bash
docker compose up -d
docker compose exec -T demo node /demo/hello-world.mjs
```

## Conformance (run against any LAM server)

Prereqs: Node.js (18+) + a running LAM server + two tokens (same tenant, different scopes).

```bash
npm install
BASE_URL="http://127.0.0.1:8080" \
API_TOKEN_A="..." \
API_TOKEN_B="..." \
npm run conformance
```

### One-command local harness (Docker)

Prereqs: Docker Desktop (or Docker Engine) + Node.js (18+).

```bash
npm install
npm run conformance:local
```

Port busy? Run `npm run conformance:local -- --port 18080`.

## SDKs

- TypeScript: `sdk/ts/`
- Python: `sdk/python/`

## Licensing & trademarks

- License: Apache-2.0 (`LICENSE`, `NOTICE`)
- Trademark policy: `TRADEMARK_POLICY.md`
- Patent pledge: `PATENT_PLEDGE.md`
