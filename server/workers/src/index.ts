import { DeviceSession } from "./durable_objects/DeviceSession";

export { DeviceSession };

export interface Env {
  DEVICE_SESSION: DurableObjectNamespace<DeviceSession>;
  ASSETS?: Fetcher;
  NEON_DATABASE_URL?: string;
  MUSUBI_ENV?: string;
  CONTROL_PLANE_ENABLED?: string;
  CONTROL_PLANE_BASIC_AUTH?: string;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/" && request.method === "GET" && controlPlaneEnabled(env)) {
      return Response.redirect(`${url.origin}/control-plane`, 302);
    }

    if (url.pathname === "/control-plane" || url.pathname.startsWith("/control-plane/")) {
      return serveControlPlane(request, env);
    }

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

function controlPlaneEnabled(env: Env) {
  return env.CONTROL_PLANE_ENABLED === "true";
}

async function serveControlPlane(request: Request, env: Env): Promise<Response> {
  if (!controlPlaneEnabled(env)) {
    return new Response("control plane disabled", { status: 404 });
  }
  if (!env.CONTROL_PLANE_BASIC_AUTH) {
    return new Response("control plane auth not configured", { status: 503 });
  }
  if (!env.ASSETS) {
    return new Response("control plane assets not configured", { status: 503 });
  }
  if (!authorized(request, env.CONTROL_PLANE_BASIC_AUTH)) {
    return new Response("authentication required", {
      status: 401,
      headers: {
        "WWW-Authenticate": 'Basic realm="Musubi Control Plane", charset="UTF-8"',
      },
    });
  }

  const url = new URL(request.url);
  const assetPath = url.pathname === "/control-plane"
    ? "/index.html"
    : url.pathname.slice("/control-plane".length);
  const assetUrl = new URL(request.url);
  assetUrl.pathname = assetPath;

  const assetRequest = new Request(assetUrl, request);
  return env.ASSETS.fetch(assetRequest);
}

function authorized(request: Request, expected: string) {
  const header = request.headers.get("Authorization");
  if (!header?.startsWith("Basic ")) return false;
  return timingSafeEqual(header.slice("Basic ".length), btoa(expected));
}

function timingSafeEqual(left: string, right: string) {
  if (left.length !== right.length) return false;
  let diff = 0;
  for (let index = 0; index < left.length; index += 1) {
    diff |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return diff === 0;
}
