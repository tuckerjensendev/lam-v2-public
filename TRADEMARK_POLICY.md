# LAM™ Trademark Policy (conformance-based)

This document describes **how you may use the LAM™ name** in connection with software, services, and documentation.

**TL;DR**
- You can always say *“compatible with the LAM protocol”* (nominative use).
- If your implementation **passes the LAM Conformance Suite** for a given version, you may call it **“LAM”** and/or **“LAM Certified vX.Y”** for that version, **as long as you include the required attribution and don’t imply endorsement**.

This is **not legal advice**. If you need legal certainty, consult counsel.

## Marks covered

The “Marks” include:
- **LAM** / **LAM™**
- **LAM Certified**
- **LAM Compatible**

## Who owns the Marks?

LAM™ is a trademark/service mark used by **Tucker Olmstead** (registration pending where applicable).

## What this policy is for

LAM is intended to be an **open protocol** with **independent implementations**. This policy is designed to:
- protect users from confusing or deceptive branding, and
- allow broad adoption by permitting use of the name **when conformance is proven**.

## Always allowed (no permission needed)

You may do the following **without** passing conformance tests, so long as it’s truthful:
- Refer to the project in text (e.g. “works with LAM”, “integrates with LAM”).
- Say your product “implements the LAM protocol” or is “compatible with the LAM protocol”.
- Link to this repository and/or to the protocol spec.

This is “nominative” use: you’re describing what you integrate with.

## Allowed if you pass conformance (permission granted)

If your implementation **passes the LAM Conformance Suite** for a specific protocol version, you may:
- Use **LAM** in the name of your implementation (e.g. “Acme LAM Server”, “LAM Server (Rust)”).
- Claim **“LAM Certified v0.1”** (or other version) for the version you passed.
- Use **“LAM Compatible”** to describe protocol compatibility.

### What “passes conformance” means

You MUST run the conformance suite defined in:
- `conformance/spec.md`

and all **normative** tests for the claimed version MUST pass.

Recommended: publish a machine-readable report produced by the runner:

```bash
npm run conformance -- --out conformance-report.json
```

## Requirements when using the Marks under this policy

If you use the Marks under the “passes conformance” permission above, you MUST:

1) **State independence clearly**
- You must not imply you are the official or endorsed implementation unless you have written permission.

2) **Include the required attribution**
- In docs/about pages (and ideally in CLI `--version` output), include:
  - “LAM is a trademark of Tucker Olmstead. Used under the LAM Trademark Policy.”

3) **Be specific about version**
- Your claim MUST include the version (e.g. “LAM Certified v0.1”).

4) **Be ready to show proof**
- Provide the conformance report (or a reproducible way to run the suite) on request.

## Prohibited uses (without separate written permission)

You may NOT:
- Use the Marks in a way that suggests **endorsement**, **partnership**, or **official** status.
- Use the Marks in a misleading way (e.g. claiming “LAM Certified” without passing tests).
- Register confusingly similar marks/domains.
- Use any LAM logos (if/when published) as your primary branding.

## Revocation

If you violate this policy, permission to use the Marks under it terminates automatically.

## Questions

If you’re unsure whether a use is acceptable, open an issue describing:
- your proposed name/branding,
- the protocol version,
- and (if applicable) your conformance report output (`--out`).
