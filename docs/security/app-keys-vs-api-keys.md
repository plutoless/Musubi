# App Keys vs API Keys

Musubi apps use two separate key concepts.

## App Encryption Keys

App encryption keys are X25519 key pairs. The app keeps the private key and the relay stores the public key. They are used to encrypt app payloads to device public keys and decrypt encrypted plugin results.

The relay must not store app private keys.

## App API Keys

App API keys authenticate app-runtime requests to the relay. The relay returns the API key secret once and stores a SHA-256 hash plus a short prefix for display.

App API keys are intentionally scoped. They can send messages and read their own message lifecycle, but they cannot manage devices, grants, apps, or control-plane settings.

Revoke an API key when it is exposed, unused, or rotated out.

## Native App Session Tokens

Native apps such as Hermes Companion are public clients. They should not ship with or ask the user to paste a long-lived app API key.

Instead, the native app uses loopback PKCE:

1. The native app creates a durable per-install X25519 app keypair.
2. The native app sends only the app public key during Musubi authorization.
3. The user signs in to Musubi UI and approves device access.
4. Musubi returns an authorization code to `http://127.0.0.1:<49152-65535>/callback` or `http://[::1]:<49152-65535>/callback`.
5. The native app exchanges the code and PKCE verifier for a short-lived app session token.

The app session token authenticates runtime calls, but current grants are checked on every request. If the user revokes a grant, the same live session immediately loses access to that device/channel.

## What Native Hermes Users Handle

Native Hermes users should only need to understand:

- Workspace: the Musubi boundary containing their apps, devices, grants, policy, and audit logs.
- Device: their registered Mac or local machine.
- Device grant: their approval that lets Hermes Companion ask for specific Hermes channels on that device.
- Local policy: the device-side allow/deny rules that still decide whether a request can run.

Native Hermes users should not copy or paste:

- App API keys.
- App private keys.
- App key ids.
- Local SDK config paths.

Those remain developer/backend concerns, not the recommended native Hermes setup path.
