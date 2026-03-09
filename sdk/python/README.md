# LAM SDK (Python)

Tiny, “official” client for calling a LAM server over HTTP.

## Install (editable, in-repo)

```sh
cd sdk/python
python -m venv .venv
source .venv/bin/activate
pip install -e .
```

## Usage

```py
from lam_sdk import LamClient

lam = LamClient(base_url="http://127.0.0.1:8080", token="...")

lam.ingest("I prefer blunt answers.")
lam.ingest_bytes(b"\x89PNG\r\n\x1a\n", content_type="image/png", claims=[{"type": "FACT", "canonical": "This is a PNG image"}])
print(lam.recall("blunt"))
print(lam.retrieve("blunt", include_quotes=True, evidence_strategy="max_span"))
```

## Scope selection (“diagram mode”)

By default, scope is derived only from the API token.

If the server is configured with `LAM_ALLOW_SCOPE_SELECTOR=1` (or the deprecated alias `LAM_ALLOW_REQUEST_SCOPE=1`), you may pass `scope_*` and `namespace` values:

```py
lam.ingest("Project note", scope_project="proj:abc", namespace="prod")
```

The server validates the requested scope against the API key’s scope patterns (`exact`, `*`, `prefix*`).
