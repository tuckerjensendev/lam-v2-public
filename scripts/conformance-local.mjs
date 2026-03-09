import { spawnSync } from "node:child_process";

function run(cmd, args, opts = {}) {
  const res = spawnSync(cmd, args, { stdio: "inherit", ...opts });
  if (res.error) throw res.error;
  if (res.status !== 0) throw new Error(`Command failed (${res.status}): ${cmd} ${args.join(" ")}`);
  return res;
}

function runQuiet(cmd, args) {
  const res = spawnSync(cmd, args, { stdio: "ignore" });
  if (res.error) return { ok: false };
  return { ok: res.status === 0 };
}

function pickCompose() {
  if (runQuiet("docker", ["compose", "version"]).ok) return { cmd: "docker", baseArgs: ["compose"] };
  if (runQuiet("docker-compose", ["version"]).ok) return { cmd: "docker-compose", baseArgs: [] };
  throw new Error("Missing Docker Compose. Install Docker Desktop (recommended) or docker-compose.");
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitForHealth(baseUrl, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${baseUrl}/health`, { method: "GET" });
      const json = await res.json().catch(() => null);
      if (res.ok && json && json.ok === true) return;
    } catch {
      // ignore
    }
    await sleep(200);
  }
  throw new Error(`Timed out waiting for health at ${baseUrl}/health`);
}

async function mintKey(apiUrl, adminToken, { tenantId, scopeUser, namespace, label }) {
  const res = await fetch(`${apiUrl}/admin/keys`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${adminToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      tenant_id: tenantId,
      scope_user: scopeUser,
      namespace,
      label,
    }),
  });

  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }

  if (!res.ok) {
    throw new Error(`Mint key failed: HTTP ${res.status} ${text || "(empty)"}`);
  }

  const token = String(json?.token ?? "").trim();
  if (!token) throw new Error("Mint key response missing token");
  return token;
}

function parseArgs(argv) {
  const out = { keep: false, port: 8080 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--keep") out.keep = true;
    else if (a === "--port") {
      const v = argv[i + 1];
      if (!v) throw new Error("Missing value for --port");
      out.port = Number(v);
      if (!Number.isFinite(out.port) || out.port < 1 || out.port > 65535) throw new Error(`Invalid --port: ${v}`);
      i++;
    } else {
      throw new Error(`Unknown arg: ${a}`);
    }
  }
  return out;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const baseUrl = `http://127.0.0.1:${args.port}`;
  const apiUrl = `${baseUrl}/v1`;

  const adminToken = String(process.env.LAM_ADMIN_TOKEN || "demo-admin").trim();
  const tenantId = Number(process.env.LAM_CONFORMANCE_TENANT_ID || "1");
  const namespace = String(process.env.LAM_CONFORMANCE_NAMESPACE || "conformance").trim() || "conformance";

  const { cmd, baseArgs } = pickCompose();
  const composeFile = "local/compose.yml";
  const composeEnv = { ...process.env, LAM_DEMO_HTTP_PORT: String(args.port) };

  try {
    run(cmd, [...baseArgs, "-f", composeFile, "up", "-d"], { env: composeEnv });

    process.stdout.write(`\nWaiting for LAM health at ${baseUrl}/health ...\n`);
    await waitForHealth(baseUrl, 60_000);

    process.stdout.write("Minting two conformance tokens (same tenant, different scopes) ...\n");
    const tokenA = await mintKey(apiUrl, adminToken, {
      tenantId,
      scopeUser: "u1",
      namespace,
      label: `conformance-a-${new Date().toISOString().slice(0, 10)}`,
    });
    const tokenB = await mintKey(apiUrl, adminToken, {
      tenantId,
      scopeUser: "u2",
      namespace,
      label: `conformance-b-${new Date().toISOString().slice(0, 10)}`,
    });

    run("npm", ["run", "conformance"], {
      env: {
        ...process.env,
        BASE_URL: baseUrl,
        API_TOKEN_A: tokenA,
        API_TOKEN_B: tokenB,
      },
    });
  } finally {
    const keep = args.keep || String(process.env.KEEP || "").trim() === "1";
    if (keep) {
      process.stdout.write("\nKEEP=1 set; leaving Docker Compose stack running.\n");
      process.stdout.write(`To stop: docker compose -f local/compose.yml down -v --remove-orphans\n`);
      return;
    }

    process.stdout.write("\nTearing down local Docker Compose stack ...\n");
    try {
      run(cmd, [...baseArgs, "-f", composeFile, "down", "-v", "--remove-orphans"], { env: composeEnv });
    } catch {
      process.stderr.write("(teardown failed; you may need to run docker compose down manually)\n");
    }
  }
}

main().catch((err) => {
  process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
