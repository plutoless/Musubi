# Using Musubi from a Browser App Safely

Use a backend bridge. Do not call Musubi directly from browser code with app credentials.

1. Create a user-owned or first-party app with the M3 SDK flow.
2. Store `MUSUBI_API_KEY` and `MUSUBI_APP_PRIVATE_KEY` on the app backend.
3. Authenticate the browser to your app backend with your normal user session.
4. Let the backend start a task with `@musubi/app-sdk`.
5. Stream task events to the browser with SSE.
6. Use a backend cancel endpoint for cancellation.

The reference implementation is `apps/hermes-companion`.

Run the verifier:

```sh
bun run verify:m3.5-browser-session
```

The verifier proves that the browser can start a Hermes task, receive live events, cancel, reconnect to task status, and never receive long-lived Musubi credentials.
