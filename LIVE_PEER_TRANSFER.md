# Live Fiber Peer Transfer

This repo has been verified against two real `nervos/fiber:0.9.0-rc7` Fiber
Network Nodes running locally as separate peers. This document is the local
two-peer proof. The hosted submission flow is now simpler: testers paste any
Fiber invoice into `https://fiber-ir-604bdd.fly.dev/?section=demo`; the API asks
the hosted sender node to `send_payment` and records the actual Fiber result.

The successful run used:

- node A RPC: `http://127.0.0.1:42227`
- node B RPC: `http://127.0.0.1:42327`
- node A pubkey:
  `039a5f93f92b94491c9c20aa1795a7e5d8920beb94edba717386603120b8af81b8`
- node B pubkey:
  `020cd2093717e540f1ca98a74edfae01078e45fe36ae9cf16f9fff2def0c4a4605`
- channel id:
  `0xcffc95361fe4446b0ec88f8995da1c6de802a143d5b3dbbadbd594e5125fdf0c`
- channel outpoint:
  `0x584337776689a38ba12360f599a56644b73f83f66f9f356d50cf87c0982d94ee00000000`
- payment hash:
  `0x3c1d9d98bcdb9390a21011bb10f3f5f9c3af7299c56c9f47c72742f02c18c5b7`
- payment status: `Success`

The resulting `payment_succeeded` event was posted to the hosted FiberIR API at
`https://fiber-ir-604bdd.fly.dev/v1/events` and accepted with `action: "stored"`.
The hosted dashboard exposes the invoice sender at
`https://fiber-ir-604bdd.fly.dev/?section=demo`.

## Notes

- The run uses throwaway CKB testnet keys under `/tmp/fiber-ir-peers`.
- Do not commit or reuse those keys for anything valuable.
- RPC is bound to `127.0.0.1`, so Biscuit RPC auth is not needed for this local
  demo. If RPC is exposed on a public interface, configure
  `--rpc-biscuit-public-key` and pass a signed bearer token to `fnn-cli`.
- The bundled RUSD UDT whitelist was disabled in the generated local config
  because its testnet type id did not resolve through the public testnet RPC
  during this run. CKB channel funding and Fiber scripts remained enabled.
- The official faucet endpoint funded both throwaway addresses with testnet CKB.

## Verification Commands

Check peers:

```bash
docker run --rm --network host --entrypoint fnn-cli nervos/fiber:0.9.0-rc7 \
  --url http://127.0.0.1:42227 --output-format json --no-banner \
  peer connect_peer \
  --address /ip4/127.0.0.1/tcp/42328/p2p/QmW2o99nPAU7DJqEXsBWDFy14fv74shQHdxUW6GG9q4YmW
```

Check the channel:

```bash
docker run --rm --network host --entrypoint fnn-cli nervos/fiber:0.9.0-rc7 \
  --url http://127.0.0.1:42227 --output-format json --no-banner \
  channel list_channels --include-closed true
```

Check the successful payment:

```bash
curl -sS http://127.0.0.1:42227 \
  -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"get_payment","params":[{"payment_hash":"0x3c1d9d98bcdb9390a21011bb10f3f5f9c3af7299c56c9f47c72742f02c18c5b7"}]}'
```

Expected result:

```json
{
  "payment_hash": "0x3c1d9d98bcdb9390a21011bb10f3f5f9c3af7299c56c9f47c72742f02c18c5b7",
  "status": "Success",
  "fee": "0x0"
}
```

## Demo Flow

1. Start two FNN containers with loopback RPC and separate `/tmp` data dirs.
2. Fund both throwaway CKB testnet addresses through the official faucet.
3. Connect node A to node B over Fiber P2P.
4. Open a private one-way channel from A to B.
5. Wait for `ChannelReady`.
6. Create a `Fibt` invoice on B.
7. Send the invoice payment from A.
8. Poll `get_payment` on A until it reports `Success`.
9. Submit the resulting `payment_succeeded` event to FiberIR.
