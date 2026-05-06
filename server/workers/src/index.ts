import { DeviceSession } from "./durable_objects/DeviceSession";

export { DeviceSession };

export interface Env {
  DEVICE_SESSION: DurableObjectNamespace<DeviceSession>;
  NEON_DATABASE_URL?: string;
  MUSUBI_ENV?: string;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    const connectMatch = url.pathname.match(/^\/v1\/devices\/([^/]+)\/connect$/);
    if (connectMatch) {
      const id = env.DEVICE_SESSION.idFromName(connectMatch[1]);
      return env.DEVICE_SESSION.get(id).fetch(request);
    }

    if (url.pathname === "/v1/health") {
      return Response.json({
        ok: true,
        service: "musubi-worker",
        env: env.MUSUBI_ENV ?? "unknown",
        neon_configured: Boolean(env.NEON_DATABASE_URL),
      });
    }

    const controlId = env.DEVICE_SESSION.idFromName("__control");
    return env.DEVICE_SESSION.get(controlId).fetch(request);
  },
};
