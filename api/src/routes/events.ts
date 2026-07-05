import type { FastifyInstance } from "fastify";
import { fiberIncidentEventV1Schema } from "@fiber-ir/collector";
import type { IncidentRepository } from "../store/incidents-repo.js";

export async function registerEventRoutes(app: FastifyInstance, repo: IncidentRepository) {
  app.post("/v1/events", async (request, reply) => {
    const parsed = fiberIncidentEventV1Schema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: "Invalid fiber-ir.event.v1 payload",
        issues: parsed.error.issues
      });
    }

    const result = await repo.ingestEvent(parsed.data);
    return reply.code(result.action === "created" ? 201 : 200).send(result);
  });
}
