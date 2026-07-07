import { spawn, type ChildProcess } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";

const rootDir = new URL("..", import.meta.url);
const npmBin = process.platform === "win32" ? "npm.cmd" : "npm";
const apiUrl = process.env.FIR_API_URL?.trim() || "http://127.0.0.1:8787";
const dashboardUrl = process.env.FIR_DASHBOARD_URL?.trim() || "http://127.0.0.1:5173";
const children = new Set<ChildProcess>();

async function main(): Promise<void> {
  const api = start("api", ["--workspace", "@fiber-ir/api", "run", "dev"], {
    PORT: new URL(apiUrl).port || "8787"
  });
  const dashboard = start("dashboard", [
    "--workspace",
    "@fiber-ir/dashboard",
    "run",
    "dev",
    "--",
    "--host",
    "127.0.0.1",
    "--port",
    new URL(dashboardUrl).port || "5173"
  ]);

  await waitForHttp(`${apiUrl}/healthz`, "API");
  await seedFixture();
  await waitForHttp(dashboardUrl, "dashboard");

  console.log("");
  console.log("Fiber IR demo is running.");
  console.log(`Dashboard: ${dashboardUrl}`);
  console.log(`API health: ${apiUrl}/healthz`);
  console.log("Press Ctrl+C to stop both servers.");

  await Promise.race([exitPromise(api), exitPromise(dashboard)]);
  shutdown();
}

function start(label: string, args: string[], env: Record<string, string> = {}): ChildProcess {
  const child = spawn(npmBin, args, {
    cwd: rootDir,
    env: {
      ...process.env,
      ...env
    },
    stdio: ["ignore", "pipe", "pipe"]
  });

  children.add(child);
  prefixOutput(label, child);
  child.once("exit", () => children.delete(child));
  return child;
}

function prefixOutput(label: string, child: ChildProcess): void {
  child.stdout?.on("data", (chunk) => writePrefixed(label, chunk));
  child.stderr?.on("data", (chunk) => writePrefixed(label, chunk));
}

function writePrefixed(label: string, chunk: Buffer): void {
  for (const line of chunk.toString().split(/\r?\n/)) {
    if (line.trim()) {
      console.log(`[${label}] ${line}`);
    }
  }
}

async function waitForHttp(url: string, label: string): Promise<void> {
  const deadline = Date.now() + 30_000;

  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { headers: { accept: "application/json" } });
      if (response.ok || response.status === 404) {
        return;
      }
    } catch {
      // Keep polling while the dev server starts.
    }

    await delay(500);
  }

  throw new Error(`${label} did not become reachable at ${url}`);
}

async function seedFixture(): Promise<void> {
  console.log("[demo] Seeding fixture incident...");

  await new Promise<void>((resolve, reject) => {
    const child = spawn(npmBin, ["--workspace", "@fiber-ir/examples", "run", "demo:fixture"], {
      cwd: rootDir,
      env: {
        ...process.env,
        FIR_API_URL: apiUrl,
        FIR_DEMO_SUMMARY: "1"
      },
      stdio: ["ignore", "pipe", "pipe"]
    });

    prefixOutput("seed", child);
    child.once("exit", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`Fixture seed failed with exit code ${code ?? "unknown"}`));
      }
    });
  });
}

function exitPromise(child: ChildProcess): Promise<void> {
  return new Promise((resolve) => child.once("exit", () => resolve()));
}

function shutdown(): void {
  for (const child of children) {
    child.kill("SIGINT");
  }
}

process.once("SIGINT", () => {
  shutdown();
  process.exit(130);
});
process.once("SIGTERM", () => {
  shutdown();
  process.exit(143);
});

await main().catch((error) => {
  shutdown();
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
