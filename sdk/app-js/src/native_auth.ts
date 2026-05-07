export interface NativeAuthorizationOptions {
  apiBaseUrl: string;
  clientId: string;
  workspaceId: string;
  redirectUri: string;
  appPublicKey: string;
  requestedCapabilities?: Array<{ plugin: string; channels: string[]; reason?: string }>;
  state?: string;
}

export interface NativeTokenExchangeOptions {
  apiBaseUrl: string;
  code: string;
  redirectUri: string;
  codeVerifier: string;
}

export function generatePkceVerifier(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return base64Url(bytes);
}

export async function pkceChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return base64Url(new Uint8Array(digest));
}

export async function createNativeAuthorization(options: NativeAuthorizationOptions) {
  const codeVerifier = generatePkceVerifier();
  const codeChallenge = await pkceChallenge(codeVerifier);
  const response = await postJson(`${options.apiBaseUrl.replace(/\/$/, "")}/v1/oauth/native/authorize`, {
    client_id: options.clientId,
    workspace_id: options.workspaceId,
    redirect_uri: options.redirectUri,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
    requested_capabilities: options.requestedCapabilities ?? [{
      plugin: "hermes",
      channels: ["hermes.task.create", "hermes.task.cancel", "hermes.task.status"],
    }],
    app_public_key: options.appPublicKey,
    state: options.state,
  });
  return { ...response, codeVerifier, codeChallenge };
}

export async function exchangeNativeAuthorizationCode(options: NativeTokenExchangeOptions) {
  return postJson(`${options.apiBaseUrl.replace(/\/$/, "")}/v1/oauth/native/token`, {
    code: options.code,
    redirect_uri: options.redirectUri,
    code_verifier: options.codeVerifier,
  });
}

async function postJson(url: string, body: unknown) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(json.error || `${response.status} ${response.statusText}`);
  return json;
}

function base64Url(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}
