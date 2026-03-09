# LAM Compatibility & Certification

LAM is designed to support **multiple independent implementations** that behave the same way at the protocol level.

The project’s compatibility contract is defined by:
- The normative spec: `conformance/spec.md`
- The executable test suite: `conformance/runner/run.ts` + `conformance/fixtures/*`

## “LAM Certified v0.1”

“LAM Certified v0.1” means: **the implementation passes the LAM Conformance Suite’s normative behaviors for v0.1**.

## How to run the conformance suite

Against a running server:

```bash
BASE_URL="http://127.0.0.1:8080" \
API_TOKEN_A="..." \
API_TOKEN_B="..." \
npm run conformance
```

Write a machine-readable report:

```bash
npm run conformance -- --out conformance-report.json
```

One-command local harness:

```bash
npm run conformance:local
```

## How to claim compatibility in your docs

If you pass conformance, a recommended statement is:

> This is an independent implementation of the LAM protocol.  
> LAM is a trademark of Tucker Olmstead. Used under the LAM Trademark Policy.  
> Conformance: LAM Certified v0.1 (report: `<link-to-your-report>`).

See `TRADEMARK_POLICY.md` for the rules on using “LAM”, “LAM Certified”, and “LAM Compatible”.
