type CoreMethod = "node_info" | "list_peers" | "list_channels";
type OptionalMethod = "list_payments" | "get_payment";
type ProbeMethod = CoreMethod | OptionalMethod;

type JsonRpcResponse = {
  jsonrpc?: string;
  id?: string | number | null;
  result?: unknown;
  error?: unknown;
};

type ShapeSummary = {
  type: string;
  count?: number;
  fieldCount?: number;
  fields?: string[];
  collectionCounts?: Record<string, number>;
  [key: string]: unknown;
};

type ProbeError = {
  category: "transport" | "http" | "rpc" | "invalid_response" | "configuration" | "unknown";
  message: string;
  code?: string | number;
  status?: number;
  dataShape?: ShapeSummary;
};

type ProbeMethodResult =
  | {
      ok: true;
      durationMs: number;
      summary: ShapeSummary;
    }
  | {
      ok: false;
      durationMs: number;
      error: ProbeError;
      skipped?: true;
    };

const CORE_METHODS = ["node_info", "list_peers", "list_channels"] as const satisfies readonly CoreMethod[];
const OPTIONAL_METHODS = ["list_payments", "get_payment"] as const satisfies readonly OptionalMethod[];
const METHOD_ORDER = [...CORE_METHODS, ...OPTIONAL_METHODS] as const satisfies readonly ProbeMethod[];
const KNOWN_METHODS = new Set<ProbeMethod>(METHOD_ORDER);

const env = process.env;
const observedAt = new Date().toISOString();

async function main(): Promise<void> {
  const url = env.FIBER_RPC_URL?.trim();

  if (!url) {
    printAndExit(
      {
        observedAt,
        endpoint: {
          configured: false
        },
        methods: {},
        exit: {
          ok: false,
          code: 1,
          reason: "FIBER_RPC_URL is required"
        }
      },
      1
    );
    return;
  }

  await runProbe(url);
}

async function runProbe(url: string): Promise<void> {
  const endpoint = describeEndpoint(url);

  if (!endpoint.configured) {
    printAndExit(
      {
        observedAt,
        endpoint,
        methods: {},
        exit: {
          ok: false,
          code: 1,
          reason: endpoint.error
        }
      },
      1
    );
    return;
  }

  const selection = selectMethods(env);
  const client = new JsonRpcClient(url, parseAuthHeader(env.FIBER_RPC_AUTH_HEADER));
  const methods: Partial<Record<ProbeMethod, ProbeMethodResult>> = {};

  for (const method of selection.methods) {
    const call = buildCall(method, env, selection.explicitMethods);

    if (call.skipped) {
      methods[method] = {
        ok: false,
        durationMs: 0,
        skipped: true,
        error: {
          category: "configuration",
          message: call.reason
        }
      };
      continue;
    }

    const started = Date.now();

    try {
      const result = await client.call(method, call.params);
      methods[method] = {
        ok: true,
        durationMs: Date.now() - started,
        summary: summarizeMethodResult(method, result)
      };
    } catch (error) {
      methods[method] = {
        ok: false,
        durationMs: Date.now() - started,
        error: summarizeError(error)
      };
    }
  }

  const exit = determineExit(selection.methods, methods);

  printAndExit(
    {
      observedAt,
      endpoint,
      selection: {
        methods: selection.methods,
        ignoredMethods: selection.ignoredMethods,
        authHeader: env.FIBER_RPC_AUTH_HEADER?.trim() ? "provided" : "not_provided"
      },
      methods,
      exit
    },
    exit.code
  );
}

class JsonRpcClient {
  private nextId = 1;

  constructor(
    private readonly url: string,
    private readonly authHeader: string | undefined
  ) {}

  async call(method: string, params: unknown): Promise<unknown> {
    let response: Response;

    try {
      response = await fetch(this.url, {
        method: "POST",
        headers: {
          accept: "application/json",
          "content-type": "application/json",
          ...(this.authHeader ? { authorization: this.authHeader } : {})
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: this.nextId++,
          method,
          ...(params === undefined ? {} : { params })
        })
      });
    } catch (error) {
      throw new ProbeRequestError("transport", toErrorMessage(error));
    }

    const text = await response.text();
    const body = parseJson(text);

    if (!response.ok) {
      throw new ProbeHttpError(response.status, response.statusText, body);
    }

    if (!isRecord(body)) {
      throw new ProbeRequestError("invalid_response", "Fiber JSON-RPC response was not a JSON object");
    }

    const rpcBody = body as JsonRpcResponse;

    if (rpcBody.error !== undefined && rpcBody.error !== null) {
      throw ProbeRpcError.fromJsonRpcError(rpcBody.error);
    }

    if (!("result" in rpcBody)) {
      throw new ProbeRequestError("invalid_response", "Fiber JSON-RPC response did not include a result");
    }

    return rpcBody.result;
  }
}

class ProbeRequestError extends Error {
  constructor(
    readonly category: ProbeError["category"],
    message: string
  ) {
    super(message);
    this.name = "ProbeRequestError";
  }
}

class ProbeHttpError extends Error {
  constructor(
    readonly status: number,
    statusText: string,
    readonly responseBody: unknown
  ) {
    super(`Fiber JSON-RPC HTTP ${status}${statusText ? ` ${statusText}` : ""}`);
    this.name = "ProbeHttpError";
  }
}

class ProbeRpcError extends Error {
  private constructor(
    message: string,
    readonly code: string | number | undefined,
    readonly data: unknown
  ) {
    super(message);
    this.name = "ProbeRpcError";
  }

  static fromJsonRpcError(error: unknown): ProbeRpcError {
    if (!isRecord(error)) {
      return new ProbeRpcError("Unknown Fiber JSON-RPC error", undefined, error);
    }

    const message = typeof error.message === "string" ? error.message : "Unknown Fiber JSON-RPC error";
    const code = typeof error.code === "string" || typeof error.code === "number" ? error.code : undefined;

    return new ProbeRpcError(message, code, error.data);
  }
}

function selectMethods(probeEnv: NodeJS.ProcessEnv): {
  methods: ProbeMethod[];
  ignoredMethods: string[];
  explicitMethods: Set<ProbeMethod>;
} {
  const parsedMethods = parseMethods(probeEnv.FIBER_RPC_METHODS);
  const explicitMethods = new Set(parsedMethods.methods);
  const defaultMethods: ProbeMethod[] = [...CORE_METHODS];

  if (shouldIncludeListPayments(probeEnv, explicitMethods)) {
    defaultMethods.push("list_payments");
  }

  if (shouldIncludeGetPayment(probeEnv, explicitMethods)) {
    defaultMethods.push("get_payment");
  }

  const explicitCoreMethods = CORE_METHODS.filter((method) => explicitMethods.has(method));
  const explicitOptionalMethods = OPTIONAL_METHODS.filter((method) => explicitMethods.has(method));
  const methods = explicitMethods.size
    ? [...(explicitCoreMethods.length ? explicitCoreMethods : CORE_METHODS), ...explicitOptionalMethods]
    : defaultMethods;

  return {
    methods,
    ignoredMethods: parsedMethods.ignoredMethods,
    explicitMethods
  };
}

function parseMethods(value: string | undefined): { methods: ProbeMethod[]; ignoredMethods: string[] } {
  if (!value?.trim()) {
    return { methods: [], ignoredMethods: [] };
  }

  const methods: ProbeMethod[] = [];
  const ignoredMethods: string[] = [];

  for (const rawMethod of value.split(/[,\s]+/)) {
    const method = rawMethod.trim();

    if (!method) {
      continue;
    }

    if (KNOWN_METHODS.has(method as ProbeMethod)) {
      methods.push(method as ProbeMethod);
    } else {
      ignoredMethods.push(method);
    }
  }

  return {
    methods: [...new Set(methods)],
    ignoredMethods
  };
}

function shouldIncludeListPayments(
  probeEnv: NodeJS.ProcessEnv,
  explicitMethods: ReadonlySet<ProbeMethod>
): boolean {
  return Boolean(
    explicitMethods.has("list_payments") ||
      probeEnv.FIBER_RPC_LIST_PAYMENTS?.trim() ||
      probeEnv.FIBER_RPC_LIST_PAYMENTS_STATUS?.trim() ||
      probeEnv.FIBER_RPC_LIST_PAYMENTS_LIMIT?.trim() ||
      probeEnv.FIBER_RPC_LIST_PAYMENTS_AFTER?.trim()
  );
}

function shouldIncludeGetPayment(
  probeEnv: NodeJS.ProcessEnv,
  explicitMethods: ReadonlySet<ProbeMethod>
): boolean {
  return Boolean(explicitMethods.has("get_payment") || probeEnv.FIBER_RPC_PAYMENT_HASH?.trim());
}

function buildCall(
  method: ProbeMethod,
  probeEnv: NodeJS.ProcessEnv,
  explicitMethods: ReadonlySet<ProbeMethod>
): { params?: unknown; skipped?: false } | { skipped: true; reason: string } {
  switch (method) {
    case "node_info":
    case "list_peers":
      return {};

    case "list_channels":
      return { params: [buildListChannelsParams(probeEnv)] };

    case "list_payments":
      if (!shouldIncludeListPayments(probeEnv, explicitMethods)) {
        return { skipped: true, reason: "Set FIBER_RPC_LIST_PAYMENTS=1 or include list_payments in FIBER_RPC_METHODS" };
      }

      return { params: [buildListPaymentsParams(probeEnv)] };

    case "get_payment": {
      const paymentHash = probeEnv.FIBER_RPC_PAYMENT_HASH?.trim();

      if (!paymentHash) {
        return { skipped: true, reason: "FIBER_RPC_PAYMENT_HASH is required before calling get_payment" };
      }

      return { params: [{ payment_hash: paymentHash }] };
    }
  }
}

function buildListChannelsParams(probeEnv: NodeJS.ProcessEnv): Record<string, unknown> {
  const params: Record<string, unknown> = {};
  const pubkey = probeEnv.FIBER_RPC_CHANNEL_PUBKEY?.trim();
  const includeClosed = parseOptionalBoolean(probeEnv.FIBER_RPC_CHANNEL_INCLUDE_CLOSED);
  const onlyPending = parseOptionalBoolean(probeEnv.FIBER_RPC_CHANNEL_ONLY_PENDING);

  if (pubkey) {
    params.pubkey = pubkey;
  }

  if (includeClosed !== undefined) {
    params.include_closed = includeClosed;
  }

  if (onlyPending !== undefined) {
    params.only_pending = onlyPending;
  }

  return params;
}

function buildListPaymentsParams(probeEnv: NodeJS.ProcessEnv): Record<string, unknown> {
  const params: Record<string, unknown> = {
    limit: parseOptionalHexLimit(probeEnv.FIBER_RPC_LIST_PAYMENTS_LIMIT) ?? "0x5"
  };
  const status = probeEnv.FIBER_RPC_LIST_PAYMENTS_STATUS?.trim();
  const after = probeEnv.FIBER_RPC_LIST_PAYMENTS_AFTER?.trim();

  if (status) {
    params.status = status;
  }

  if (after) {
    params.after = after;
  }

  return params;
}

function determineExit(
  selectedMethods: readonly ProbeMethod[],
  methods: Partial<Record<ProbeMethod, ProbeMethodResult>>
): { ok: boolean; code: number; reason: string } {
  const attemptedResults = selectedMethods
    .map((method) => methods[method])
    .filter((result): result is ProbeMethodResult => Boolean(result && !("skipped" in result)));
  const coreResults = CORE_METHODS.map((method) => methods[method]).filter(
    (result): result is ProbeMethodResult => Boolean(result && !("skipped" in result))
  );

  if (!selectedMethods.length || !attemptedResults.length) {
    return {
      ok: false,
      code: 1,
      reason: "No safe Fiber JSON-RPC methods were selected for execution"
    };
  }

  if (
    attemptedResults.length > 0 &&
    attemptedResults.every(
      (result) => !result.ok && ["transport", "http", "invalid_response"].includes(result.error.category)
    )
  ) {
    return {
      ok: false,
      code: 1,
      reason: "Fiber JSON-RPC endpoint was missing, unreachable, or did not return JSON-RPC"
    };
  }

  if (coreResults.length > 0 && coreResults.every((result) => !result.ok)) {
    return {
      ok: false,
      code: 1,
      reason: "All selected core read-only Fiber RPC methods failed"
    };
  }

  return {
    ok: true,
    code: 0,
    reason: "At least one required core read-only Fiber RPC method succeeded"
  };
}

function summarizeMethodResult(method: ProbeMethod, result: unknown): ShapeSummary {
  switch (method) {
    case "node_info":
      return summarizeNodeInfo(result);

    case "list_peers":
      return summarizeCollectionResult(result, "peers");

    case "list_channels":
      return summarizeCollectionResult(result, "channels");

    case "list_payments":
      return {
        ...summarizeCollectionResult(result, "payments"),
        lastCursorPresent: isRecord(result) && result.last_cursor !== undefined && result.last_cursor !== null
      };

    case "get_payment":
      return summarizePayment(result);
  }
}

function summarizeNodeInfo(result: unknown): ShapeSummary {
  if (!isRecord(result)) {
    return summarizeShape(result);
  }

  return {
    ...summarizeShape(result),
    versionPresent: typeof result.version === "string",
    nodeNamePresent: typeof result.node_name === "string",
    pubkeyPresent: typeof result.pubkey === "string",
    addressesCount: countArray(result.addresses),
    featuresCount: countArray(result.features),
    channelCountPresent: result.channel_count !== undefined,
    pendingChannelCountPresent: result.pending_channel_count !== undefined
  };
}

function summarizeCollectionResult(result: unknown, collectionKey: string): ShapeSummary {
  if (Array.isArray(result)) {
    return {
      type: "array",
      count: result.length,
      itemType: result.length ? typeOfJson(result[0]) : undefined
    };
  }

  if (!isRecord(result)) {
    return summarizeShape(result);
  }

  const collection = result[collectionKey];

  return {
    ...summarizeShape(result),
    [`${collectionKey}Count`]: Array.isArray(collection) ? collection.length : undefined
  };
}

function summarizePayment(result: unknown): ShapeSummary {
  if (!isRecord(result)) {
    return summarizeShape(result);
  }

  return {
    ...summarizeShape(result),
    status: typeof result.status === "string" ? result.status : undefined,
    failedErrorPresent: result.failed_error !== undefined && result.failed_error !== null,
    routersCount: countArray(result.routers),
    customRecordsPresent: result.custom_records !== undefined && result.custom_records !== null
  };
}

function summarizeShape(value: unknown): ShapeSummary {
  if (Array.isArray(value)) {
    return {
      type: "array",
      count: value.length,
      itemType: value.length ? typeOfJson(value[0]) : undefined
    };
  }

  if (!isRecord(value)) {
    return {
      type: typeOfJson(value)
    };
  }

  const keys = Object.keys(value).sort();
  const collectionCounts: Record<string, number> = {};

  for (const key of keys) {
    const child = value[key];

    if (Array.isArray(child)) {
      collectionCounts[key] = child.length;
    }
  }

  return {
    type: "object",
    fieldCount: keys.length,
    fields: keys.slice(0, 12),
    ...(Object.keys(collectionCounts).length ? { collectionCounts } : {})
  };
}

function summarizeError(error: unknown): ProbeError {
  if (error instanceof ProbeHttpError) {
    return {
      category: "http",
      status: error.status,
      message: error.message,
      dataShape: summarizeShape(error.responseBody)
    };
  }

  if (error instanceof ProbeRpcError) {
    return {
      category: "rpc",
      message: truncate(error.message),
      code: error.code,
      dataShape: summarizeShape(error.data)
    };
  }

  if (error instanceof ProbeRequestError) {
    return {
      category: error.category,
      message: truncate(error.message)
    };
  }

  if (error instanceof Error) {
    return {
      category: "unknown",
      message: truncate(error.message)
    };
  }

  return {
    category: "unknown",
    message: "Unknown Fiber JSON-RPC probe failure",
    dataShape: summarizeShape(error)
  };
}

function describeEndpoint(url: string):
  | {
      configured: true;
      protocol: string;
      host: string;
      path: string;
      searchParamCount: number;
      credentialsInUrl: boolean;
    }
  | {
      configured: false;
      error: string;
    } {
  try {
    const parsed = new URL(url);

    return {
      configured: true,
      protocol: parsed.protocol.replace(/:$/, ""),
      host: parsed.host,
      path: parsed.pathname || "/",
      searchParamCount: parsed.searchParams.size,
      credentialsInUrl: Boolean(parsed.username || parsed.password)
    };
  } catch (error) {
    return {
      configured: false,
      error: `FIBER_RPC_URL is not a valid URL: ${toErrorMessage(error)}`
    };
  }
}

function parseAuthHeader(value: string | undefined): string | undefined {
  const trimmed = value?.trim();

  if (!trimmed) {
    return undefined;
  }

  const authorizationMatch = /^authorization\s*:\s*(.+)$/i.exec(trimmed);
  return authorizationMatch?.[1]?.trim() || trimmed;
}

function parseOptionalBoolean(value: string | undefined): boolean | undefined {
  const normalized = value?.trim().toLowerCase();

  if (!normalized) {
    return undefined;
  }

  if (["1", "true", "yes", "on"].includes(normalized)) {
    return true;
  }

  if (["0", "false", "no", "off"].includes(normalized)) {
    return false;
  }

  return undefined;
}

function parseOptionalHexLimit(value: string | undefined): string | undefined {
  const trimmed = value?.trim();

  if (!trimmed) {
    return undefined;
  }

  if (/^0x[0-9a-f]+$/i.test(trimmed)) {
    return trimmed;
  }

  const parsed = Number.parseInt(trimmed, 10);
  return Number.isSafeInteger(parsed) && parsed > 0 ? `0x${parsed.toString(16)}` : undefined;
}

function parseJson(text: string): unknown {
  if (!text.trim()) {
    return undefined;
  }

  try {
    return JSON.parse(text);
  } catch (error) {
    throw new ProbeRequestError("invalid_response", `Invalid JSON response: ${toErrorMessage(error)}`);
  }
}

function countArray(value: unknown): number | undefined {
  return Array.isArray(value) ? value.length : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function typeOfJson(value: unknown): string {
  if (value === null) {
    return "null";
  }

  if (Array.isArray(value)) {
    return "array";
  }

  return typeof value;
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function truncate(value: string, maxLength = 300): string {
  return value.length > maxLength ? `${value.slice(0, maxLength)}...` : value;
}

function printAndExit(result: unknown, code: number): void {
  console.log(JSON.stringify(result, null, 2));
  process.exitCode = code;
}

await main();
