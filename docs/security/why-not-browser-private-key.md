# Why Not Put MUSUBI_APP_PRIVATE_KEY in the Browser

`MUSUBI_APP_PRIVATE_KEY` is a long-lived app encryption secret. If it is put in browser JavaScript, local storage, session storage, or a frontend bundle, any XSS bug, extension, shared computer, or copied bundle can expose it.

Use this boundary instead:

- Browser: user session token, task session ID, optional ephemeral session key.
- App backend: `MUSUBI_API_KEY`, `MUSUBI_APP_PRIVATE_KEY`, App SDK.
- Musubi relay: routing, grants, status, audit metadata, opaque ciphertext.
- Device: decrypts tasks, enforces local policy, encrypts results.

For first-party apps, the backend is trusted to decrypt events and stream browser-safe task events to the authenticated user. If a product needs stricter browser transport hygiene, add an ephemeral browser session key and have the backend re-encrypt events to that short-lived key.
