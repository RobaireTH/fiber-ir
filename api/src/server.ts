import Fastify from "fastify";
import { registerEventRoutes } from "./routes/events.js";
import { registerIncidentRoutes } from "./routes/incidents.js";
import {
  InMemoryIncidentRepository,
  JsonFileIncidentRepository,
  type IncidentRepository
} from "./store/incidents-repo.js";

type BuildServerOptions = {
  logger?: boolean;
  repo?: IncidentRepository;
};

export async function buildServer(options: BuildServerOptions = {}) {
  const app = Fastify({ logger: options.logger ?? true });
  const { repo, store } = options.repo
    ? { repo: options.repo, store: "custom" }
    : createIncidentRepositoryFromEnvironment();

  app.get("/healthz", async () => ({
    ok: true,
    store
  }));

  await registerEventRoutes(app, repo);
  await registerIncidentRoutes(app, repo);

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
