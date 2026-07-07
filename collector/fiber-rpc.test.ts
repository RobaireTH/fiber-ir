import { describe, expect, it } from "vitest";
import {
  createFiberRpcClientFromEnv,
  FiberJsonRpcError,
  FiberJsonRpcHttpClient,
  FiberRpcCollector
} from "./src/adapters/fiber-rpc";

type FetchCall = {
  input: Parameters<typeof fetch>[0];
  init: Parameters<typeof fetch>[1];
};

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
    ...init
  });
}

function textResponse(body: string, init: ResponseInit = {}): Response {
  return new Response(body, init);
}

function fakeFetch(response: Response): { calls: FetchCall[]; fetchImpl: typeof fetch } {
  const calls: FetchCall[] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    calls.push({ input, init });
    return response;
  };

  return { calls, fetchImpl };
}

describe("FiberJsonRpcHttpClient", () => {
  it("posts a JSON-RPC request and returns a successful result", async () => {
    const { calls, fetchImpl } = fakeFetch(
      jsonResponse({
        jsonrpc: "2.0",
        id: "request-1",
        result: { version: "fnn-test" }
      })
    );
    const client = new FiberJsonRpcHttpClient({
      url: "http://127.0.0.1:8227",
      fetchImpl,
      idFactory: () => "request-1"
    });

    const result = await client.call({ method: "node_info", params: { verbose: true } });

    expect(result).toStrictEqual({ version: "fnn-test" });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.input).toBe("http://127.0.0.1:8227");
    expect(calls[0]?.init?.method).toBe("POST");
    expect(calls[0]?.init?.headers).toMatchObject({
      accept: "application/json",
      "content-type": "application/json"
    });
    expect(JSON.parse(String(calls[0]?.init?.body))).toStrictEqual({
      jsonrpc: "2.0",
      id: "request-1",
      method: "node_info",
      params: { verbose: true }
    });
  });

  it("throws a FiberJsonRpcError for a JSON-RPC error response", async () => {
    const { fetchImpl } = fakeFetch(
      jsonResponse({
        jsonrpc: "2.0",
        id: 7,
        error: {
          code: -32601,
          message: "Method not found",
          data: { method: "unknown_method", token: "secret-token" }
        }
      })
    );
    const client = new FiberJsonRpcHttpClient({ url: "http://127.0.0.1:8227", fetchImpl });

    try {
      await client.call({ method: "unknown_method" });
      throw new Error("expected JSON-RPC call to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(FiberJsonRpcError);
      expect(error).toMatchObject({
        name: "FiberJsonRpcError",
        code: -32601,
        message: "Method not found"
      });
    }
  });

  it("throws an HTTP error for a non-OK response without trusting the body as a result", async () => {
    const { fetchImpl } = fakeFetch(textResponse("upstream unavailable", { status: 503 }));
    const client = new FiberJsonRpcHttpClient({ url: "http://127.0.0.1:8227", fetchImpl });

    await expect(client.call({ method: "node_info" })).rejects.toThrow(
      "Fiber JSON-RPC HTTP 503: upstream unavailable"
    );
  });

  it("throws an invalid JSON error for an OK response with invalid JSON", async () => {
    const { fetchImpl } = fakeFetch(textResponse("{not json", { status: 200 }));
    const client = new FiberJsonRpcHttpClient({ url: "http://127.0.0.1:8227", fetchImpl });

    await expect(client.call({ method: "node_info" })).rejects.toThrow("Invalid Fiber JSON-RPC response");
  });

  it("throws when an OK response is empty or malformed without a result", async () => {
    const empty = new FiberJsonRpcHttpClient({
      url: "http://127.0.0.1:8227",
      fetchImpl: fakeFetch(textResponse("", { status: 200 })).fetchImpl
    });
    const malformed = new FiberJsonRpcHttpClient({
      url: "http://127.0.0.1:8227",
      fetchImpl: fakeFetch(jsonResponse({ jsonrpc: "2.0", id: 1 })).fetchImpl
    });

    await expect(empty.call({ method: "node_info" })).rejects.toThrow(
      "Fiber JSON-RPC response did not include a result"
    );
    await expect(malformed.call({ method: "node_info" })).rejects.toThrow(
      "Fiber JSON-RPC response did not include a result"
    );
  });

  it("passes configured headers through and lets them override defaults", async () => {
    const { calls, fetchImpl } = fakeFetch(jsonResponse({ jsonrpc: "2.0", id: 1, result: null }));
    const client = new FiberJsonRpcHttpClient({
      url: "http://127.0.0.1:8227",
      fetchImpl,
      headers: {
        authorization: "Bearer fnn",
        accept: "application/fiber+json"
      }
    });

    await expect(client.call({ method: "node_info" })).resolves.toBeNull();

    expect(calls[0]?.init?.headers).toMatchObject({
      authorization: "Bearer fnn",
      accept: "application/fiber+json",
      "content-type": "application/json"
    });
  });
});

describe("createFiberRpcClientFromEnv", () => {
  it("passes FIBER_RPC_AUTH_HEADER into the HTTP client headers", async () => {
    const { calls, fetchImpl } = fakeFetch(jsonResponse({ jsonrpc: "2.0", id: 1, result: { ok: true } }));
    const originalFetch = globalThis.fetch;
    globalThis.fetch = fetchImpl;

    try {
      const client = createFiberRpcClientFromEnv({
        FIBER_RPC_URL: "http://127.0.0.1:8227",
        FIBER_RPC_AUTH_HEADER: "Bearer env-token"
      });

      await client?.call({ method: "node_info" });
    } finally {
      globalThis.fetch = originalFetch;
    }

    expect(calls[0]?.init?.headers).toMatchObject({
      authorization: "Bearer env-token"
    });
  });
});

describe("FiberRpcCollector", () => {
  it("returns object-wrapped and null-ish read-only results without assuming arrays", async () => {
    const calls: string[] = [];
    const rpc = {
      call: async ({ method }: { method: string }) => {
        calls.push(method);
        if (method === "node_info") return { nodeId: "node-a" };
        if (method === "list_peers") return { peers: [{ peerId: "peer-a" }] };
        if (method === "list_channels") return null;
        throw new Error(`unexpected method ${method}`);
      }
    };
    const collector = new FiberRpcCollector(rpc);

    await expect(collector.snapshotNodeHealth()).resolves.toMatchObject({
      nodeInfo: { nodeId: "node-a" },
      peers: { peers: [{ peerId: "peer-a" }] },
      channels: null
    });
    expect(calls).toStrictEqual(["node_info", "list_peers", "list_channels"]);
  });

  it("uses FNN struct params for list_channels, get_payment, and list_payments", async () => {
    const calls: Array<{ method: string; params: unknown }> = [];
    const rpc = {
      call: async ({ method, params }: { method: string; params?: unknown }) => {
        calls.push({ method, params });
        return {};
      }
    };
    const collector = new FiberRpcCollector(rpc);

    await collector.listChannels();
    await collector.getPayment("0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
    await collector.listPayments({ limit: "0x5" });

    expect(calls).toStrictEqual([
      { method: "list_channels", params: [{}] },
      {
        method: "get_payment",
        params: [{ payment_hash: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" }]
      },
      { method: "list_payments", params: [{ limit: "0x5" }] }
    ]);
  });

  it("does not create an incident for non-terminal send_payment results", async () => {
    const collector = new FiberRpcCollector({
      call: async () => ({
        payment_hash: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        status: "Created"
      })
    });

    await expect(collector.attemptPayment(wrappedPaymentInput())).resolves.toBeNull();
  });

  it("polls get_payment after send_payment until a terminal failed status is observed", async () => {
    const calls: Array<{ method: string; params: unknown }> = [];
    const rpc = {
      call: async ({ method, params }: { method: string; params?: unknown }) => {
        calls.push({ method, params });

        if (method === "send_payment") {
          return {
            payment_hash: "0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
            status: "Created"
          };
        }

        if (method === "get_payment" && calls.filter((call) => call.method === "get_payment").length === 1) {
          return {
            payment_hash: "0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
            status: "Inflight"
          };
        }

        if (method === "get_payment") {
          return {
            payment_hash: "0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
            status: "Failed",
            failed_error: "no route found"
          };
        }

        throw new Error(`unexpected method ${method}`);
      }
    };
    const collector = new FiberRpcCollector(rpc);

    await expect(
      collector.sendPaymentAndObserve(wrappedPaymentInput({ paymentId: undefined }), {
        pollIntervalMs: 0,
        delay: async () => undefined
      })
    ).resolves.toMatchObject({
      kind: "payment_attempt_failed",
      payment: {
        paymentId: "0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
        fiberPaymentStatus: "Failed"
      },
      error: {
        message: "no route found"
      }
    });
    expect(calls).toStrictEqual([
      { method: "send_payment", params: [{ invoice: "fibt1..." }] },
      {
        method: "get_payment",
        params: [{ payment_hash: "0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc" }]
      },
      {
        method: "get_payment",
        params: [{ payment_hash: "0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc" }]
      }
    ]);
  });

  it("emits a payment_succeeded event when observed FNN payment status succeeds", async () => {
    const collector = new FiberRpcCollector({
      call: async ({ method }: { method: string }) => {
        if (method === "send_payment") {
          return {
            payment_hash: "0xdddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
            status: "Created"
          };
        }

        return {
          payment_hash: "0xdddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
          status: "Success"
        };
      }
    });

    await expect(
      collector.sendPaymentAndObserve(wrappedPaymentInput({ eventId: "evt_live_success_001", paymentId: undefined }))
    ).resolves.toMatchObject({
      eventId: "evt_live_success_001",
      kind: "payment_succeeded",
      source: "fiber_rpc",
      provenance: {
        payment: "live",
        paymentStatus: "live",
        rpcMethod: "live"
      },
      payment: {
        paymentId: "0xdddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
        fiberPaymentStatus: "Success"
      }
    });
  });

  it("returns null while an observed FNN payment remains non-terminal", async () => {
    const collector = new FiberRpcCollector({
      call: async () => ({
        payment_hash: "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
        status: "Inflight"
      })
    });

    await expect(
      collector.sendPaymentAndObserve(wrappedPaymentInput(), {
        maxPolls: 1,
        pollIntervalMs: 0,
        delay: async () => undefined
      })
    ).resolves.toBeNull();
  });

  it("preserves JSON-RPC error codes when send_payment fails", async () => {
    const collector = new FiberRpcCollector({
      call: async () => {
        throw new FiberJsonRpcError("Payment rejected", -32000, { reason: "route_not_found" });
      }
    });

    await expect(collector.attemptPayment(wrappedPaymentInput())).resolves.toMatchObject({
      kind: "payment_attempt_failed",
      error: {
        code: "-32000",
        message: "Payment rejected",
        raw: {
          name: "FiberJsonRpcError",
          code: -32000,
          message: "Payment rejected",
          data: { reason: "route_not_found" }
        }
      }
    });
  });

  it("creates an incident event for terminal failed FNN payment results", async () => {
    const collector = new FiberRpcCollector({
      call: async () => ({
        payment_hash: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        status: "Failed",
        failed_error: "Failed to build route",
        fee: "0x0"
      })
    });

    await expect(collector.attemptPayment(wrappedPaymentInput())).resolves.toMatchObject({
      kind: "payment_attempt_failed",
      source: "fiber_rpc",
      payment: {
        paymentId: "pay_live_001",
        fiberPaymentStatus: "Failed"
      },
      error: {
        message: "Failed to build route",
        raw: {
          payment_hash: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
          status: "Failed",
          failed_error: "Failed to build route"
        }
      }
    });
  });
});

type WrappedPaymentInputFixture = {
  eventId: string;
  senderNode: string;
  destinationNode: string;
  paymentId?: string;
  asset: string;
  amount: string;
  params: Array<{ invoice: string }>;
};

function wrappedPaymentInput(overrides: Partial<WrappedPaymentInputFixture> = {}): WrappedPaymentInputFixture {
  return {
    eventId: "evt_live_payment_001",
    senderNode: "alice-node",
    destinationNode: "bob-node",
    paymentId: "pay_live_001",
    asset: "CKB",
    amount: "10000",
    params: [{ invoice: "fibt1..." }],
    ...overrides
  };
}
