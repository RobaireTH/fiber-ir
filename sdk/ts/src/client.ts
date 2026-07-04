import type { FiberIncidentEventV1 } from "@fiber-ir/shared";

export class FiberIncidentClient {
  constructor(private readonly baseUrl: string) {}

  async recordEvent(event: FiberIncidentEventV1): Promise<unknown> {
    const response = await fetch(`${this.baseUrl}/v1/events`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(event)
    });

    if (!response.ok) {
      throw new Error(`Failed to record Fiber incident event: ${response.status}`);
    }

    return response.json();
  }
}

