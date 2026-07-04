import type { FiberIncidentEventV1 } from "@fiber-ir/shared";

export type FixtureScenario = {
  scenarioId: string;
  title: string;
  events: FiberIncidentEventV1[];
};

export function replayFixture(scenario: FixtureScenario): FiberIncidentEventV1[] {
  return scenario.events.map((event) => ({
    ...event,
    source: "fixture_replay",
    provenance: {
      ...event.provenance,
      fixture: "fixture"
    }
  }));
}

