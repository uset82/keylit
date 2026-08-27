export default {
  async fetch(request, env) {
    if (!env?.ASSETS?.fetch) {
      return new Response("Static asset binding unavailable", { status: 500 });
    }

    return env.ASSETS.fetch(request);
  },
};
