export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method !== "GET" && request.method !== "HEAD") {
      return new Response("method not allowed", { status: 405 });
    }

    if (url.pathname === "/health") {
      return new Response("oki", {
        status: 200,
        headers: {
          "content-type": "text/plain; charset=utf-8",
          "cache-control": "no-store",
        },
      });
    }

    // Route the app's HTML entry points that a static file server cannot map.
    if (url.pathname === "/stream/anime") {
      return env.ASSETS.fetch(new URL("/player.html", url.origin));
    }
    if (url.pathname === "/s") {
      return env.ASSETS.fetch(new URL("/index.html", url.origin));
    }

    const asset = await env.ASSETS.fetch(request);
    if (asset.status !== 404) return asset;

    // SPA-style fallback for extensionless routes; keep real 404s for files.
    if (!/\.[a-z0-9]+$/i.test(url.pathname)) {
      const fallback = await env.ASSETS.fetch(
        new URL("/index.html", url.origin),
      );
      if (fallback.status !== 404) return fallback;
    }
    return asset;
  },
};
