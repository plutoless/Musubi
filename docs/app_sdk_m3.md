# Musubi M3 App SDK

M3 makes app-side Musubi integration a supported path instead of a collection of local-dev scripts. The scope is a TypeScript SDK, user-owned app creation, app-scoped API keys, event polling, cancellation, and documentation for Hermes and Codex tasks.

## Boundaries

- The relay stores app public keys and API key hashes only.
- App private keys stay with the app runtime or local CLI config.
- App API keys can list granted devices, fetch granted device public keys, send messages, read their own message status/events, and cancel their own messages.
- App API keys cannot manage apps, devices, grants, or other control-plane resources.
- Payloads and plugin results remain encrypted end-to-end; server-visible message and audit records contain routing, status, and crypto metadata only.

## Delivered Interfaces

- `sdk/app-js`: `@musubi/app-sdk` TypeScript SDK for Bun/Node-style backends.
- `musubi app create`: user-owned app creation with local X25519 key generation and one-time SDK env output.
- Relay endpoints for app API key management and app-scoped runtime calls.
- Control-plane app detail panels for API keys, encryption key metadata, and SDK quickstart snippets.

## Runtime Flow

1. A user creates an app with `musubi app create`.
2. The CLI generates the app X25519 private key locally and sends only the public key to the relay.
3. The relay creates an API key, stores its SHA-256 hash, and returns the secret once.
4. The user grants the app explicit device/plugin channels.
5. SDK code fetches a granted device public key, encrypts payloads, posts a message envelope, polls encrypted events, decrypts results, and can request cancellation.

## Verification

Run:

```sh
bun run verify:m3-app-sdk
```

The verifier covers user-owned app creation, hashed API keys, encrypted echo/Hermes/Codex invocations, decrypted event polling, final results, cancellation, API key revocation, API key scope denial on grants, and plaintext leak checks.
