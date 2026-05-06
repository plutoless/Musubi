export class MusubiError extends Error {
  code: string;
  status?: number;
  details?: unknown;

  constructor(message: string, options: { code?: string; status?: number; details?: unknown } = {}) {
    super(message);
    this.name = new.target.name;
    this.code = options.code ?? "MUSUBI_ERROR";
    this.status = options.status;
    this.details = options.details;
  }
}

export class MusubiAuthError extends MusubiError {}
export class MusubiGrantDeniedError extends MusubiError {}
export class MusubiDeviceOfflineError extends MusubiError {}
export class MusubiLocalPolicyDeniedError extends MusubiError {}
export class MusubiPluginNotFoundError extends MusubiError {}
export class MusubiMessageTimeoutError extends MusubiError {}
export class MusubiDecryptError extends MusubiError {}
export class MusubiCancelledError extends MusubiError {}
export class MusubiServerError extends MusubiError {}

export function normalizeMusubiError(error: unknown): MusubiError {
  if (error instanceof MusubiError) return error;
  if (error instanceof Error) return new MusubiError(error.message, { details: error });
  return new MusubiError(String(error));
}

export function errorFromResponse(status: number, body: any): MusubiError {
  const message = body?.error || body?.message || `Musubi request failed with ${status}`;
  const normalized = String(message).toLowerCase();
  const options = { status, details: body, code: body?.error_code || body?.code };
  if (status === 401) return new MusubiAuthError(message, { ...options, code: options.code ?? "AUTHENTICATION_FAILED" });
  if (normalized.includes("grant denied") || normalized.includes("channel denied") || normalized.includes("app denied")) {
    return new MusubiGrantDeniedError(message, { ...options, code: options.code ?? "GRANT_DENIED" });
  }
  if (normalized.includes("device offline")) {
    return new MusubiDeviceOfflineError(message, { ...options, code: options.code ?? "DEVICE_OFFLINE" });
  }
  if (normalized.includes("policy")) {
    return new MusubiLocalPolicyDeniedError(message, { ...options, code: options.code ?? "LOCAL_POLICY_DENIED" });
  }
  if (normalized.includes("plugin") && normalized.includes("not")) {
    return new MusubiPluginNotFoundError(message, { ...options, code: options.code ?? "PLUGIN_NOT_FOUND" });
  }
  if (status >= 500) return new MusubiServerError(message, { ...options, code: options.code ?? "SERVER_ERROR" });
  return new MusubiError(message, options);
}
