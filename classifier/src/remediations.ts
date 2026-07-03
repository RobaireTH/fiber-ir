import type { IncidentClass, Remediation } from "@fiber-ir/shared";

export const remediations: Record<IncidentClass, Remediation> = {
  NO_ROUTE: {
    code: "REFRESH_ROUTE_OR_SPLIT_PAYMENT",
    title: "Refresh route data or split the payment",
    detail:
      "Refresh graph and channel data, verify the destination, retry with a smaller amount, or use alternate route hints."
  },
  PEER_OFFLINE: {
    code: "CHECK_PEER_CONNECTIVITY",
    title: "Check peer connectivity",
    detail:
      "Reconnect the peer, verify node process and network status, or retry through another peer."
  },
  CHANNEL_NOT_READY: {
    code: "WAIT_OR_REENABLE_CHANNEL",
    title: "Wait for channel readiness",
    detail:
      "Check channel state, confirmations, disabled flags, and avoid pending or closing channels."
  },
  INSUFFICIENT_OUTBOUND_LIQUIDITY: {
    code: "REBALANCE_OUTBOUND",
    title: "Add or rebalance outbound liquidity",
    detail:
      "Rebalance the sending channel, choose a channel with capacity, split the payment, or lower the amount."
  },
  INSUFFICIENT_INBOUND_LIQUIDITY: {
    code: "ADD_INBOUND_CAPACITY",
    title: "Add inbound liquidity",
    detail:
      "Request inbound capacity, open or lease an inbound channel, use another receiver route, or split the payment."
  },
  ASSET_MISMATCH: {
    code: "MATCH_INVOICE_ASSET",
    title: "Use the invoice asset",
    detail: "Validate the invoice asset and route only through channels that support the same asset."
  },
  FEE_TOO_LOW: {
    code: "INCREASE_FEE_BUDGET",
    title: "Increase fee budget",
    detail: "Refresh fee estimates and retry with a higher maximum fee or fee rate."
  },
  PAYMENT_TIMEOUT: {
    code: "RETRY_WITH_FRESH_ROUTE",
    title: "Retry with a fresh route",
    detail: "Increase timeout, refresh route data, and check peer latency or node health."
  },
  INVOICE_EXPIRED: {
    code: "REQUEST_NEW_INVOICE",
    title: "Request a new invoice",
    detail: "Generate a fresh invoice and verify client clock synchronization."
  },
  UNKNOWN_NODE_FAILURE: {
    code: "INSPECT_NODE_LOGS",
    title: "Inspect node logs",
    detail: "Preserve raw error context, retry once if safe, and inspect node/channel snapshots."
  }
};

