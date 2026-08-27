export default {
  async fetch(request, env) {
    if (!env?.ASSETS?.fetch) {
      return new Response("Static asset binding unavailable", { status: 500 });
    }

    const url = new URL(request.url);
    if (url.pathname === "/") {
      url.pathname = "/index.html";
    }

    return env.ASSETS.fetch(new Request(url, request));
  },
};
