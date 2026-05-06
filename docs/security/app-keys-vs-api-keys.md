# App Keys vs API Keys

Musubi apps use two separate key concepts.

## App Encryption Keys

App encryption keys are X25519 key pairs. The app keeps the private key and the relay stores the public key. They are used to encrypt app payloads to device public keys and decrypt encrypted plugin results.

The relay must not store app private keys.

## App API Keys

App API keys authenticate app-runtime requests to the relay. The relay returns the API key secret once and stores a SHA-256 hash plus a short prefix for display.

App API keys are intentionally scoped. They can send messages and read their own message lifecycle, but they cannot manage devices, grants, apps, or control-plane settings.

Revoke an API key when it is exposed, unused, or rotated out.
