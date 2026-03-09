# Contributing to LAM

Thanks for your interest in contributing!

## Ways to contribute

- Bug reports and reproduction steps
- Spec clarifications (conformance-driven)
- Conformance fixtures (portable, deterministic)
- SDK improvements (TypeScript / Python)
- Documentation improvements (protocol, security, operations)

## Ground rules

- **Protocol changes are conformance changes.** If behavior changes, update `conformance/spec.md` and add/adjust fixtures under `conformance/fixtures/`.
- Keep behavior **scope-locked** (no cross-tenant / cross-scope leakage).
- Preserve the “proof” contract: `evidence_id` must decode to bounded excerpts deterministically.

## Development

Prereqs: Node.js (18+). Docker is only required for the optional local harness.

Common commands:

- Install: `npm install`
- Conformance (against a running LAM server): `BASE_URL=... API_TOKEN_A=... API_TOKEN_B=... npm run conformance`
- Conformance (one-command local harness via Docker): `npm run conformance:local`
- TypeScript SDK (in-repo): `cd sdk/ts && npm install && npm run build`
- Python SDK (in-repo): `cd sdk/python && python -m venv .venv && source .venv/bin/activate && pip install -e .`

Note: this repository does not include the LAM reference server source. If you want to contribute to the reference server implementation, email `support@lam-protocol.com`.

## License

By contributing, you agree that your contributions will be licensed under the Apache-2.0 license (see `LICENSE`).
