import type { FastifyInstance } from "fastify";
import { INCIDENT_STATUSES, type IncidentStatus } from "@fiber-ir/shared";
import type { IncidentRepository } from "../store/incidents-repo.js";

type ListQuery = {
  status?: IncidentStatus;
  class?: string;
};

export async function registerIncidentRoutes(app: FastifyInstance, repo: IncidentRepository) {
  app.get<{ Querystring: ListQuery }>("/v1/incidents", async (request) => {
    return { items: await repo.list(request.query), nextCursor: null };
  });

  app.get<{ Params: { id: string } }>("/v1/incidents/:id", async (request, reply) => {
    const incident = await repo.get(request.params.id);
    if (!incident) return reply.code(404).send({ error: "Incident not found" });
    return incident;
  });

  app.patch<{ Params: { id: string }; Body: { incidentStatus: IncidentStatus; resolutionNote?: string } }>(
    "/v1/incidents/:id",
    async (request, reply) => {
      if (!isIncidentStatus(request.body?.incidentStatus)) {
        return reply.code(400).send({
          error: "Invalid incidentStatus",
          allowed: INCIDENT_STATUSES
        });
      }

      const incident = await repo.updateStatus(
        request.params.id,
        request.body.incidentStatus,
        request.body.resolutionNote
      );
      if (!incident) return reply.code(404).send({ error: "Incident not found" });
      return incident;
    }
  );

  app.get("/v1/stats/summary", async () => await repo.summary());
}

function isIncidentStatus(value: unknown): value is IncidentStatus {
  return typeof value === "string" && INCIDENT_STATUSES.includes(value as IncidentStatus);
}
