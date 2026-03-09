# LAM SDK (TypeScript)

Tiny, “official” client for calling a LAM server over HTTP.

## Install (in-repo)

This SDK is intentionally self-contained. If you’re consuming it from this repo:

```sh
cd sdk/ts
npm install
npm run build
```

## Usage

```ts
import { LamClient } from "@lam/memory-sdk";

const lam = new LamClient({
  baseUrl: "http://127.0.0.1:8080",
  token: process.env.LAM_TOKEN!,
});

await lam.ingest("I prefer blunt answers.");

// Binary bytes (base64 under the hood)
await lam.ingestBytes(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), {
  content_type: "image/png",
  claims: [{ type: "FACT", canonical: "This is a PNG image" }],
});

const recall = await lam.recall("blunt");
const bundle = await lam.retrieve("blunt", { include_quotes: true, evidence_strategy: "max_span" });
```

## Scope selection (“diagram mode”)

By default, scope is derived only from the API token.

If the server is configured with `LAM_ALLOW_SCOPE_SELECTOR=1` (or the deprecated alias `LAM_ALLOW_REQUEST_SCOPE=1`), you may pass a `scope` object on calls:

```ts
await lam.ingest("Project note", {
  scope: { scope_project: "proj:abc", namespace: "prod" },
});
```

The server will validate the requested scope against the API key’s scope patterns (`exact`, `*`, `prefix*`).
