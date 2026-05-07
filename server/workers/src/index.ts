import { DeviceSession } from "./durable_objects/DeviceSession";

export { DeviceSession };

export interface Env {
  DEVICE_SESSION: DurableObjectNamespace<DeviceSession>;
  ASSETS?: Fetcher;
  NEON_DATABASE_URL?: string;
  MUSUBI_ENV?: string;
  CONTROL_PLANE_ENABLED?: string;
  MUSUBI_ADMIN_USERNAME?: string;
  MUSUBI_ADMIN_PASSWORD?: string;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if ((url.pathname === "/" || url.pathname === "/control-plane") && request.method === "GET" && controlPlaneEnabled(env)) {
      return Response.redirect(`${url.origin}/control-plane/user`, 302);
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
  if (!env.ASSETS) {
    return new Response("control plane assets not configured", { status: 503 });
  }

  const url = new URL(request.url);
  const assetPath = url.pathname === "/control-plane"
    ? "/index.html"
    : controlPlaneAssetPath(url.pathname);
  const assetUrl = new URL(request.url);
  assetUrl.pathname = assetPath;

  const assetRequest = new Request(assetUrl, request);
  return env.ASSETS.fetch(assetRequest);
}

function controlPlaneAssetPath(pathname: string) {
  const path = pathname.slice("/control-plane".length);
  if (path === "/app.js" || path === "/styles.css") return path;
  return "/index.html";
}
