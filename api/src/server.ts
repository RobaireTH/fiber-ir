import { createReadStream, statSync } from "node:fs";
import { dirname, extname, isAbsolute, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import Fastify, { type FastifyInstance, type FastifyReply } from "fastify";
import { registerDemoRoutes } from "./routes/demo.js";
import { registerEventRoutes } from "./routes/events.js";
import { registerIncidentRoutes } from "./routes/incidents.js";
import {
  InMemoryIncidentRepository,
  JsonFileIncidentRepository,
  type IncidentRepository
} from "./store/incidents-repo.js";

export type BuildServerOptions = {
  logger?: boolean;
  repo?: IncidentRepository;
  corsOrigin?: string;
  dashboardDistDir?: string;
};

export async function buildServer(options: BuildServerOptions = {}) {
  const app = Fastify({
    logger: options.logger ?? true,
    bodyLimit: positiveIntegerFromEnv("FIR_BODY_LIMIT_BYTES", 1_048_576)
  });
  const { repo, store } = options.repo
    ? { repo: options.repo, store: "custom" }
    : createIncidentRepositoryFromEnvironment();
  const dashboardDistDir = resolveDashboardDistDir(options.dashboardDistDir ?? process.env.FIR_DASHBOARD_DIST);

  registerCors(app, options.corsOrigin ?? process.env.FIR_CORS_ORIGIN);

  app.get("/healthz", async () => ({
    ok: true,
    store,
    dashboard: Boolean(dashboardDistDir)
  }));

  await registerEventRoutes(app, repo);
  await registerDemoRoutes(app, repo);
  await registerIncidentRoutes(app, repo);
  registerDashboardRoutes(app, dashboardDistDir);

  return app;
}

function createIncidentRepositoryFromEnvironment(): { repo: IncidentRepository; store: string } {
  const storeFile = process.env.FIR_STORE_FILE;
  if (storeFile) {
    return {
      repo: new JsonFileIncidentRepository(storeFile),
      store: "json-file"
    };
  }

  return {
    repo: new InMemoryIncidentRepository(),
    store: "memory-scaffold"
  };
}

function registerCors(app: FastifyInstance, corsOrigin: string | undefined): void {
  const allowedOrigins = parseAllowedOrigins(corsOrigin);
  if (!allowedOrigins.configured) return;

  app.addHook("onRequest", (request, reply, done) => {
    const origin = request.headers.origin;
    const allowedOrigin = getAllowedOrigin(origin, allowedOrigins);

    if (allowedOrigin) {
      reply.header("access-control-allow-origin", allowedOrigin);
      reply.header("vary", "Origin");
      reply.header("access-control-allow-methods", "GET,POST,PATCH,OPTIONS");
      reply.header(
        "access-control-allow-headers",
        headerList(request.headers["access-control-request-headers"], "accept,content-type")
      );
      reply.header("access-control-max-age", "86400");
    }

    if (request.method === "OPTIONS") {
      reply.code(204).send();
      return;
    }

    done();
  });
}

function registerDashboardRoutes(app: FastifyInstance, dashboardDistDir: string | undefined): void {
  if (!dashboardDistDir) return;

  const rootDir = resolve(dashboardDistDir);

  app.get("/", async (_request, reply) => sendDashboardAsset(reply, rootDir, "index.html", true));
  app.get("/*", async (request, reply) => {
    const assetPath = ((request.params as { "*": string })["*"] ?? "").replace(/^\/+/, "");

    if (assetPath === "healthz" || assetPath.startsWith("v1/")) {
      return reply.code(404).send({ error: "Not found" });
    }

    return sendDashboardAsset(reply, rootDir, assetPath, false);
  });
}

function sendDashboardAsset(
  reply: FastifyReply,
  rootDir: string,
  assetPath: string,
  forceIndexFallback: boolean
): FastifyReply {
  const requestedPath = safeStaticPath(rootDir, assetPath);
  const assetFile = requestedPath && isFile(requestedPath) ? requestedPath : undefined;
  const indexFile = resolve(rootDir, "index.html");
  const shouldFallback = forceIndexFallback || (!assetFile && !extname(assetPath));
  const filePath = assetFile ?? (shouldFallback && isFile(indexFile) ? indexFile : undefined);

  if (!filePath) {
    return reply.code(404).send({ error: "Dashboard asset not found" });
  }

  reply.header("cache-control", isImmutableDashboardAsset(filePath) ? "public, max-age=31536000, immutable" : "no-cache");
  return reply.type(contentType(filePath)).send(createReadStream(filePath));
}

function safeStaticPath(rootDir: string, assetPath: string): string | null {
  const relativePath = assetPath || "index.html";
  let decodedPath: string;

  try {
    decodedPath = decodeURIComponent(relativePath);
  } catch {
    return null;
  }

  if (decodedPath.includes("\0")) return null;

  const filePath = resolve(rootDir, decodedPath);
  if (filePath !== rootDir && !filePath.startsWith(`${rootDir}${sep}`)) {
    return null;
  }

  return filePath;
}

function isFile(filePath: string): boolean {
  try {
    return statSync(filePath).isFile();
  } catch {
    return false;
  }
}

function resolveDashboardDistDir(input: string | undefined): string | undefined {
  const configuredPath = normalizeOptionalString(input);
  if (!configuredPath) return undefined;

  const candidates = isAbsolute(configuredPath)
    ? [configuredPath]
    : [resolve(process.cwd(), configuredPath), resolve(repoRootDir(), configuredPath)];

  return candidates.find((candidate) => isFile(resolve(candidate, "index.html")));
}

function repoRootDir(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), "../..");
}

function isImmutableDashboardAsset(filePath: string): boolean {
  return filePath.includes(`${sep}assets${sep}`);
}

function contentType(filePath: string): string {
  switch (extname(filePath)) {
    case ".css":
      return "text/css; charset=utf-8";
    case ".html":
      return "text/html; charset=utf-8";
    case ".ico":
      return "image/x-icon";
    case ".js":
      return "text/javascript; charset=utf-8";
    case ".json":
      return "application/json; charset=utf-8";
    case ".map":
      return "application/json; charset=utf-8";
    case ".png":
      return "image/png";
    case ".svg":
      return "image/svg+xml";
    case ".txt":
      return "text/plain; charset=utf-8";
    default:
      return "application/octet-stream";
  }
}

function parseAllowedOrigins(input: string | undefined): {
  configured: boolean;
  allowAny: boolean;
  origins: Set<string>;
} {
  const origins = normalizeOptionalString(input)
    ?.split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);

  if (!origins?.length) {
    return { configured: false, allowAny: false, origins: new Set() };
  }

  return {
    configured: true,
    allowAny: origins.includes("*"),
    origins: new Set(origins)
  };
}

function getAllowedOrigin(
  origin: string | undefined,
  allowedOrigins: ReturnType<typeof parseAllowedOrigins>
): string | undefined {
  if (allowedOrigins.allowAny) return origin ?? "*";
  return origin && allowedOrigins.origins.has(origin) ? origin : undefined;
}

function headerList(value: string | string[] | undefined, fallback: string): string {
  if (Array.isArray(value)) return value.join(",");
  return value?.trim() || fallback;
}

function normalizeOptionalString(value: string | undefined): string | undefined {
  const normalized = value?.trim();
  return normalized || undefined;
}

function positiveIntegerFromEnv(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const app = await buildServer();
  const port = Number(process.env.PORT ?? 8787);
  app.listen({ port, host: "0.0.0.0" }, (err, address) => {
    if (err) {
      app.log.error(err);
      process.exit(1);
    }
    app.log.info(`Fiber Incident Recorder API listening at ${address}`);
  });
}
