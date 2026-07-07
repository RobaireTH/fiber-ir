import type { FiberIncidentEventV1, Provenance } from "@fiber-ir/shared";

export type FiberRpcRequest = {
  method: string;
  params?: unknown;
};

export type FiberRpcClient = {
  call<T>(request: FiberRpcRequest): Promise<T>;
};

export type FiberRpcHttpClientOptions = {
  url: string | URL;
  headers?: Record<string, string>;
  fetchImpl?: typeof fetch;
  idFactory?: () => string | number;
};

export type FiberRpcEnv = {
  FIBER_RPC_URL?: string;
  FIBER_RPC_AUTH_HEADER?: string;
};

export type FiberRpcSnapshot = {
  observedAt: string;
  nodeInfo: unknown;
  peers: unknown;
  channels: unknown;
  provenance: Record<"nodeInfo" | "peers" | "channels", Provenance>;
};

export type FiberRpcPaymentStatus = "Created" | "Inflight" | "Success" | "Failed" | string;

export type FiberRpcPayment = {
  payment_hash?: string;
  status?: FiberRpcPaymentStatus;
  created_at?: string;
  last_updated_at?: string;
  failed_error?: string | null;
  fee?: string;
  custom_records?: unknown;
  routers?: unknown;
};

export type FiberRpcListPaymentsResult = {
  payments?: FiberRpcPayment[];
  last_cursor?: string | null;
};

export type FiberRpcPaymentObservationOptions = {
  pollIntervalMs?: number;
  timeoutMs?: number;
  maxPolls?: number;
  delay?: (milliseconds: number) => Promise<void>;
  now?: () => number;
};

export type WrappedPaymentInput = {
  eventId: string;
  observedAt?: string;
  projectId?: string;
  environment?: FiberIncidentEventV1["environment"];
  paymentId?: string;
  invoiceId?: string;
  senderNode: string;
  destinationNode?: string;
  asset: string;
  amount: string;
  method?: "send_payment" | "send_payment_with_router";
  params: unknown;
  attempt?: FiberIncidentEventV1["attempt"];
  context?: FiberIncidentEventV1["context"];
  provenance?: Record<string, Provenance>;
};

export class FiberJsonRpcError extends Error {
  constructor(
    message: string,
    readonly code?: string | number,
    readonly data?: unknown
  ) {
    super(message);
    this.name = "FiberJsonRpcError";
  }

  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      data: this.data
    };
  }
}

export class FiberJsonRpcHttpClient implements FiberRpcClient {
  private nextId = 1;
  private readonly url: string;
  private readonly headers: Record<string, string>;
  private readonly fetchImpl: typeof fetch;
  private readonly idFactory: () => string | number;

  constructor(options: FiberRpcHttpClientOptions | string | URL) {
    const normalizedOptions =
      typeof options === "string" || options instanceof URL ? { url: options } : options;

    this.url = normalizedOptions.url.toString();
    this.headers = normalizedOptions.headers ?? {};
    this.fetchImpl = normalizedOptions.fetchImpl ?? fetch;
    this.idFactory = normalizedOptions.idFactory ?? (() => this.nextId++);
  }

  async call<T>({ method, params }: FiberRpcRequest): Promise<T> {
    const response = await this.fetchImpl(this.url, {
      method: "POST",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        ...this.headers
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: this.idFactory(),
        method,
        ...(params === undefined ? {} : { params })
      })
    });

    const text = await response.text();
    const body = parseJsonRpcBody(text, response.ok);

    if (isObjectRecord(body) && body.error !== undefined && body.error !== null) {
      throw toFiberJsonRpcError(body.error);
    }

    if (!response.ok) {
      const detail = text.trim() ? `: ${text.trim()}` : "";
      throw new Error(`Fiber JSON-RPC HTTP ${response.status}${detail}`);
    }

    if (!isObjectRecord(body) || !("result" in body)) {
      throw new Error("Fiber JSON-RPC response did not include a result");
    }

    return body.result as T;
  }
}

export function createFiberRpcClientFromEnv(
  env: FiberRpcEnv = defaultFiberRpcEnv()
): FiberJsonRpcHttpClient | null {
  const url = env.FIBER_RPC_URL?.trim();
  const authHeader = env.FIBER_RPC_AUTH_HEADER?.trim();
  const headers = authHeader ? { authorization: authHeader } : undefined;

  return url ? new FiberJsonRpcHttpClient({ url, headers }) : null;
}

export class FiberRpcCollector {
  constructor(private readonly rpc: FiberRpcClient) {}

  async getNodeInfo<T = unknown>(): Promise<T> {
    return this.rpc.call<T>({ method: "node_info" });
  }

  async listPeers<T = unknown>(): Promise<T> {
    return this.rpc.call<T>({ method: "list_peers" });
  }

  async listChannels<T = unknown>(): Promise<T> {
    return this.rpc.call<T>({ method: "list_channels", params: [{}] });
  }

  async getPayment<T = FiberRpcPayment>(paymentHash: string): Promise<T> {
    return this.rpc.call<T>({ method: "get_payment", params: [{ payment_hash: paymentHash }] });
  }

  async listPayments<T = FiberRpcListPaymentsResult>(params: Record<string, unknown> = {}): Promise<T> {
    return this.rpc.call<T>({ method: "list_payments", params: [params] });
  }

  async snapshotNodeHealth(): Promise<FiberRpcSnapshot> {
    const [nodeInfo, peers, channels] = await Promise.all([
      this.getNodeInfo(),
      this.listPeers(),
      this.listChannels()
    ]);

    return {
      observedAt: new Date().toISOString(),
      nodeInfo,
      peers,
      channels,
      provenance: {
        nodeInfo: "live",
        peers: "live",
        channels: "live"
      }
    };
  }

  async attemptPayment(input: WrappedPaymentInput): Promise<FiberIncidentEventV1 | null> {
    const method = input.method ?? "send_payment";

    try {
      const result = await this.rpc.call<FiberRpcPayment | null | undefined>({ method, params: input.params });
      return this.paymentResultToEvent(input, result);
    } catch (error) {
      return this.paymentFailureToEvent(input, error);
    }
  }

  async sendPaymentAndObserve(
    input: WrappedPaymentInput,
    options: FiberRpcPaymentObservationOptions = {}
  ): Promise<FiberIncidentEventV1 | null> {
    const method = input.method ?? "send_payment";

    try {
      const submitted = await this.rpc.call<FiberRpcPayment | null | undefined>({ method, params: input.params });
      const payment = submitted?.payment_hash
        ? await this.waitForPaymentTerminal(submitted.payment_hash, options, submitted)
        : submitted;

      return this.paymentResultToEvent(input, payment);
    } catch (error) {
      return this.paymentFailureToEvent(input, error);
    }
  }

  async waitForPaymentTerminal(
    paymentHash: string,
    options: FiberRpcPaymentObservationOptions = {},
    initialPayment?: FiberRpcPayment
  ): Promise<FiberRpcPayment> {
    const pollIntervalMs = Math.max(0, options.pollIntervalMs ?? 1_000);
    const timeoutMs = Math.max(0, options.timeoutMs ?? 30_000);
    const startedAt = options.now?.() ?? Date.now();
    const delay = options.delay ?? defaultDelay;
    let polls = 0;
    let payment = initialPayment;

    while (true) {
      if (payment && isTerminalPayment(payment)) {
        return payment;
      }

      if (options.maxPolls !== undefined && polls >= options.maxPolls) {
        return payment ?? (await this.getPayment(paymentHash));
      }

      const elapsed = (options.now?.() ?? Date.now()) - startedAt;
      if (elapsed >= timeoutMs) {
        return payment ?? (await this.getPayment(paymentHash));
      }

      if (polls > 0) {
        await delay(pollIntervalMs);
      }

      payment = await this.getPayment(paymentHash);
      polls += 1;
    }
  }

  paymentResultToEvent(input: WrappedPaymentInput, payment: FiberRpcPayment | null | undefined): FiberIncidentEventV1 | null {
    if (!payment) {
      return null;
    }

    if (payment.status === "Failed") {
      return this.paymentFailureToEvent(input, {
        message: payment.failed_error ?? "Fiber payment failed",
        raw: payment
      });
    }

    if (payment.status === "Success") {
      return this.paymentSuccessToEvent(input, payment);
    }

    return null;
  }

  paymentSuccessToEvent(input: WrappedPaymentInput, payment: FiberRpcPayment): FiberIncidentEventV1 {
    return {
      schemaVersion: "fiber-ir.event.v1",
      eventId: input.eventId,
      observedAt: input.observedAt ?? new Date().toISOString(),
      source: "fiber_rpc",
      projectId: input.projectId,
      environment: input.environment ?? "testnet",
      kind: "payment_succeeded",
      provenance: {
        payment: "live",
        paymentStatus: "live",
        rpcMethod: "live",
        ...input.provenance
      },
      payment: {
        paymentId: input.paymentId ?? payment.payment_hash,
        invoiceId: input.invoiceId,
        senderNode: input.senderNode,
        destinationNode: input.destinationNode,
        fiberPaymentStatus: "Success",
        asset: input.asset,
        amount: input.amount
      },
      attempt: input.attempt,
      context: input.context
    };
  }

  paymentFailureToEvent(input: WrappedPaymentInput, error: unknown): FiberIncidentEventV1 {
    const errorDetails = normalizeRpcError(error);

    return {
      schemaVersion: "fiber-ir.event.v1",
      eventId: input.eventId,
      observedAt: input.observedAt ?? new Date().toISOString(),
      source: "fiber_rpc",
      projectId: input.projectId,
      environment: input.environment ?? "testnet",
      kind: "payment_attempt_failed",
      provenance: {
        payment: "live",
        paymentStatus: "inferred",
        error: "live",
        rpcMethod: "live",
        normalizedClass: "inferred",
        ...input.provenance
      },
      payment: {
        paymentId: input.paymentId ?? paymentHashFromError(error),
        invoiceId: input.invoiceId,
        senderNode: input.senderNode,
        destinationNode: input.destinationNode,
        fiberPaymentStatus: "Failed",
        asset: input.asset,
        amount: input.amount
      },
      attempt: input.attempt,
      error: errorDetails,
      context: input.context
    };
  }
}

function parseJsonRpcBody(text: string, requireValidJson: boolean): unknown {
  if (!text.trim()) {
    return undefined;
  }

  try {
    return JSON.parse(text);
  } catch (error) {
    if (!requireValidJson) {
      return undefined;
    }

    const message = error instanceof Error ? error.message : "unknown parser error";
    throw new Error(`Invalid Fiber JSON-RPC response: ${message}`);
  }
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function toFiberJsonRpcError(error: unknown): FiberJsonRpcError {
  if (!isObjectRecord(error)) {
    return new FiberJsonRpcError("Unknown Fiber JSON-RPC error", undefined, error);
  }

  const message = typeof error.message === "string" ? error.message : "Unknown Fiber JSON-RPC error";
  const code = typeof error.code === "string" || typeof error.code === "number" ? error.code : undefined;

  return new FiberJsonRpcError(message, code, error.data);
}

function normalizeRpcError(error: unknown): NonNullable<FiberIncidentEventV1["error"]> {
  if (error instanceof FiberJsonRpcError) {
    return {
      code: error.code === undefined ? undefined : String(error.code),
      message: error.message,
      raw: error.toJSON()
    };
  }

  if (isObjectRecord(error) && typeof error.message === "string") {
    return {
      message: error.message,
      raw: "raw" in error ? error.raw : error
    };
  }

  if (error instanceof Error) {
    return {
      message: error.message,
      raw: {
        name: error.name,
        message: error.message
      }
    };
  }

  return {
    message: "Unknown Fiber RPC failure",
    raw: error
  };
}

function defaultFiberRpcEnv(): FiberRpcEnv {
  return typeof process === "undefined" ? {} : process.env;
}

function isTerminalPayment(payment: FiberRpcPayment): boolean {
  return payment.status === "Success" || payment.status === "Failed";
}

function paymentHashFromError(error: unknown): string | undefined {
  if (!isObjectRecord(error)) {
    return undefined;
  }

  const raw = isObjectRecord(error.raw) ? error.raw : error;
  return typeof raw.payment_hash === "string" ? raw.payment_hash : undefined;
}

function defaultDelay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
