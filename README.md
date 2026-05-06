# Musubi

**Musubi / 結び** is a secure app-to-device messaging layer for invoking approved local capabilities on user-owned machines.

Musubi means "connection," "knot," or "binding" in Japanese. In this product, it represents a user-controlled binding between cloud apps and local machines.

## Positioning

Musubi helps cloud apps securely communicate with a user's trusted local devices without requiring each app to build its own daemon, relay, plugin system, authorization model, and local execution layer.

The server is intended to handle identity, authorization, routing, status, and audit metadata. Business payloads should remain encrypted and opaque to the server.

## Goals

- Register local machines through a universal CLI.
- Show registered devices in a cloud control plane.
- Authorize specific apps to access specific devices.
- Authorize apps to call specific local plugins or channels.
- Send encrypted messages from apps to devices.
- Dispatch messages to local plugins.
- Return encrypted results or streaming events.
- Revoke access at any time.
- Preserve a server-blind payload model.

## Non-goals

Musubi is not:

- A VPN
- A remote desktop product
- An SSH replacement
- A remote monitoring and management platform
- A cloud agent runtime
- A service that executes user payloads on the server
- A default arbitrary shell execution platform

The preferred framing is: invoke approved local capabilities on your own machines through encrypted app-to-device messages.

## Repository Status

This repository currently contains the product documents plus a Milestone 0 prototype.

```text
apps/
  app-simulator/
  device-harness/
  relay-server/
cmd/
  musubi/
docs/
  musubi_prd_v_1.md
  policy.md
packages/
  protocol/
plugins/
  echo/
specs/
  protocol.md
tools/
  verify.ts
```

## Documents

- [Musubi PRD v1](docs/musubi_prd_v_1.md)
- [M1 architecture](docs/architecture_m1.md)
- [M1.5 Codex plugin plan](docs/musubi_m_1_5_codex_plugin_plan.md)
- [M1.6 runtime hardening plan](docs/musubi_m_1_6_runtime_hardening_plan.md)
- [M2 control plane](docs/control_plane_m2.md)
- [M2 control plane plan](docs/musubi_m_2_control_plane_plan.md)
- [M2.5 Codex adapter](docs/codex_adapter_m2_5.md)
- [Hosted M1 deployment](docs/hosted_m1_deployment.md)
- [Repository policy](docs/policy.md)

## Repository Strategy

Musubi should start as one monorepo with clean public boundaries:

- CLI, specs, SDKs, and plugins are first-class public modules.
- The cloud control plane can live in this repo at first, but should remain separable.
- Avoid splitting into many repositories until real external contributors appear.

## Milestone 0 Prototype

The prototype proves the PRD's first milestone: encrypted app-to-device relay with a local plugin boundary.

It includes:

- A Bun/TypeScript relay server at `apps/relay-server`.
- A Bun/TypeScript app simulator at `apps/app-simulator`.
- A Go CLI prototype at `cmd/musubi`.
- A Bun/TypeScript device harness at `apps/device-harness` for environments where Go is not installed.
- Shared protocol and prototype crypto helpers at `packages/protocol`.
- An `echo` plugin using JSON-RPC over stdio at `plugins/echo`.
- A scripted verifier at `tools/verify.ts`.

The relay server routes server-visible envelopes and ciphertext only. It does not decrypt request or result payloads.

### Prototype Crypto

Milestone 0 uses `musubi-demo-aes-256-gcm`, a documented prototype authenticated-encryption adapter with static demo keys shared by the app simulator and local device process. This keeps the server blind and provides real authenticated encryption, but it is not the final PRD crypto model. Milestone 1 should replace this with app/device public-key encryption and local key storage.

### Requirements

- Bun 1.3 or newer
- Go 1.22 or newer to run the Go CLI prototype

No npm package installation is required for the current Bun verifier.

### Run The Relay

```bash
bun run server
```

### Run A Local Device

Use the Go CLI when Go is installed:

```bash
go run ./cmd/musubi
```

Use the Bun device harness when Go is not installed:

```bash
bun run apps/device-harness/src/main.ts
```

Both device implementations connect to:

```text
ws://127.0.0.1:8787/v1/devices/dev_demo/connect
```

### Send An Encrypted Echo Message

In another terminal:

```bash
bun run app:echo
```

Expected output includes:

```text
[app] decrypted result {"type":"task.result","body":{"ok":true,"echo":"hello from musubi","handled_by":"echo"}}
```

### Verify

Run the end-to-end verification:

```bash
bun run verify
```

The verifier starts the relay server, starts the Bun device harness, sends an encrypted `echo.echo` request, decrypts the result in the app simulator, and checks that an unauthorized `shell.run` channel is rejected before plugin execution.

Run the same verification against the Go CLI:

```bash
bun run verify:go
```

If Go needs a writable build cache in a restricted environment, use:

```bash
GOCACHE="$PWD/.cache/go-build" go test ./...
```

### M1 Verification

Run the M1 contract and slice verifiers:

```bash
bun run verify:m1-contracts
bun run verify:slice1
bun run verify:slice2
bun run verify:slice3
bun run verify:slice4
bun run verify:slice5
bun run verify:slice6
bun run verify:slice7
bun run verify:slice8
bun run verify:slice9
bun run verify:slice10
bun run verify:slice10:hermes
bun run verify:slice11
bun run verify:slice11:build
bun run verify:slice11:local
bun run verify:slice12
bun run verify:slice12:runtime
bun run verify:slice13
bun run verify:m1-readiness
```

The local M1 implementation covers architecture contracts, plugin dispatch, device registration, app creation, grants, signed WebSocket connect, public-key encrypted echo, message/audit lifecycle, local policy denial, Hermes plugin skeleton, and a configurable Hermes runtime command seam.

Hosted Cloudflare Worker/Durable Object implementation is present under `server/workers/`. The local hosted-runtime verifier starts `wrangler dev`, registers a Go CLI device, records plugin capabilities, sends an encrypted Hermes task through the Worker/Durable Object path, verifies reconnect behavior, and checks lifecycle audit metadata:

```bash
bun run verify:slice11:local
```

For a deployed hosted run, apply Neon migrations, configure the Worker secret, deploy, then run the deployed verifier:

```bash
NEON_DATABASE_URL="<postgres-url>" bun run db:migrate:neon

cd server/workers
TMPDIR="../../.cache/tmp" BUN_INSTALL_CACHE_DIR="../../.cache/bun" bunx wrangler secret put NEON_DATABASE_URL
TMPDIR="../../.cache/tmp" BUN_INSTALL_CACHE_DIR="../../.cache/bun" bunx wrangler deploy

cd ../..
MUSUBI_HOSTED_URL="https://<worker-host>" \
NEON_DATABASE_URL="<postgres-url>" \
bun run verify:slice11:deployed
```

A real hosted deployment still requires Cloudflare authentication and Neon configuration.

Hermes runtime integration is implemented as a plugin-local process adapter. Configure `HERMES_COMMAND` to point at the real Hermes local runtime; see [plugins/hermes/README.md](plugins/hermes/README.md).

### M1.5 Codex Verification

Run the local encrypted Codex plugin flow:

```bash
bun run verify:slice12
```

Run the deterministic Codex runtime adapter check:

```bash
bun run verify:slice12:runtime
```

After configuring hosted secrets, run the deployed Cloudflare/Neon Codex proof:

```bash
MUSUBI_HOSTED_URL="https://<worker-host>" \
NEON_DATABASE_URL="<postgres-url>" \
bun run verify:slice12:deployed
```

Codex runtime integration is implemented as a plugin-local process adapter. Configure `CODEX_COMMAND` to point at a local Codex-compatible runtime; see [plugins/codex/README.md](plugins/codex/README.md).

### M1.6 Runtime Hardening Verification

Run the local negative-path hardening suite:

```bash
bun run verify:slice13
```

The suite covers denied server grants, local policy denial, unsupported Codex channels, runtime exit failures, runtime timeouts, output caps, and plaintext-free audit/status records.

After configuring hosted secrets, run the deployed negative-path Neon proof:

```bash
MUSUBI_HOSTED_URL="https://<worker-host>" \
NEON_DATABASE_URL="<postgres-url>" \
bun run verify:slice13:deployed
```

### M2 Control Plane Verification

Run the local control-plane verifier:

```bash
bun run verify:m2-control-plane
```

The local relay serves the control plane at:

```text
http://127.0.0.1:8787/control-plane
```

### M2.5 Codex Adapter Verification

Run the local Codex adapter verifier:

```bash
bun run verify:m2.5-codex
```

The verifier uses a Codex-compatible mock command for CI, proves workspace allowlist rejection, encrypted progress/result return, timeline/audit privacy, missing-binary handling, and grant revocation.

### M3 App SDK Verification

Create user-owned app credentials with local key generation:

```bash
go run ./cmd/musubi app create "My Automation" --server http://127.0.0.1:8787 --home .musubi/m3 --workspace ws_local --type user_owned --generate-key-local --env
```

Run the SDK verifier:

```bash
bun run verify:m3-app-sdk
```

The verifier covers encrypted SDK invoke/events/result/cancel flows, hashed API keys, app-key scoping, revocation, and plaintext-free server records.

### Message States

The relay represents these Milestone 0 states:

- `created`
- `validated`
- `delivered`
- `received`
- `processing`
- `completed`
- `failed`
