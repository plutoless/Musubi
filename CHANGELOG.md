# Changelog

## Unreleased

- Added the M3 TypeScript App SDK, user-owned app CLI creation, app-scoped API keys, SDK docs, and verifier.
- Added the M2.5 real Codex adapter contract, workspace-policy validation, streaming event support, and verifier.
- Added the M2 control plane plan, product contract, local control-plane UI, backend APIs, revoke semantics, and verifier.
- Added the Musubi M1.5 Codex plugin plan.
- Added the Codex plugin skeleton, CLI routing/capability reporting, and local M1.5 verifier.
- Added the M1.6 runtime hardening plan, Codex runtime timeout/output/error handling, and local/deployed negative-path verifiers.

## M1 Baseline - 2026-05-07

- Added Musubi M1 architecture, protocol, encryption, local policy, API, hosted deployment, and goal documents.
- Implemented the Go CLI for device registration, signed WebSocket relay connection, local YAML policy enforcement, replay checks, plugin dispatch, and encrypted app/device messaging.
- Added local Bun relay, app simulator, protocol schemas, echo plugin, and Hermes plugin runtime adapter.
- Added Cloudflare Worker and Durable Object hosted relay with Neon persistence for control-plane records, message status, audit events, and plugin capabilities.
- Added Postgres migrations and verifiers for M1 contracts, slices 1-11, hosted local runtime, deployed Cloudflare/Neon proof, and readiness checks.
- Verified deployed M1 on Cloudflare Workers with Neon-backed status/audit persistence.
