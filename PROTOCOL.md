# LAM™ Protocol (v0.1)

This repository contains the **public protocol surface area** for LAM v0.1:
- the normative conformance spec
- a protocol-level conformance runner (to validate independent implementations)
- tiny official client SDKs (TypeScript + Python)

## Normative spec

For v0.1, the normative (“MUST”) behaviors are defined in:
- `conformance/spec.md`

If you are implementing LAM in another language or with different storage backends, use that spec + the conformance runner as the contract.

## Reference server

LAM’s reference server implementation is not published in this repository.
For a runnable local demo bundle, use `lam-prove-it` (Docker Compose).

## Compatibility claims

If you want to call your implementation “LAM” or “LAM Certified”, follow:
- `COMPATIBILITY.md`
- `TRADEMARK_POLICY.md`
