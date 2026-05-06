# M1 Encryption Spec

M1 replaces the Milestone 0 static AES demo adapter with app/device public-key encryption.

## Algorithm

M1 envelope examples use:

```text
x25519-xsalsa20-poly1305
```

The implementation may use a well-maintained library that exposes compatible public-key sealed boxes or authenticated boxes. Any substitute must provide authenticated encryption and must be documented before use.

The local M1 implementation currently uses:

```text
x25519-aes-256-gcm
```

It derives a shared key with X25519 and uses AES-256-GCM for authenticated payload encryption. This keeps the public-key trust boundary while avoiding static Milestone 0 demo keys.

## Device-Bound Messages

1. The app fetches the active device public key and key ID.
2. The app builds a decrypted payload containing `type`, `message_id`, `nonce`, and `body`.
3. The app encrypts the payload to the device public key.
4. The server routes the ciphertext envelope.
5. The CLI decrypts using the local device private key.

## App-Bound Results

1. The CLI fetches or receives the active app public key and key ID.
2. The CLI builds an event/result payload containing `type`, `correlation_id`, and `body`.
3. The CLI encrypts the payload to the app public key.
4. The server routes or stores the ciphertext envelope.
5. The app decrypts using its app private key.

## Key Storage

The CLI stores device private keys locally under:

```text
~/.musubi/keys/device_<device_id>.key
```

The server stores only public keys and key status for production keys. Dev-only server-managed app private keys must be marked as development mode and must not be required for production.

## Key Status

Allowed key statuses:

- `active`
- `retired`
- `revoked`

New messages must use active keys. Revoked keys cannot be used for new messages.
