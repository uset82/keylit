/*__DESIGN_HANDLER__*/
/*__MUSIC_HANDLER__*/

const assets = new Map(/*__SITES_ASSETS__*/);

function decodeBase64(value) {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

export default {
  // `env` carries hosted provider credentials. They exist only in the worker,
  // never in the static bundle served to the browser.
  async fetch(request, env) {
    const url = new URL(request.url);

    // Before the asset lookup: /api/* is not a file, so the map would 404 it.
    if (url.pathname === "/api/design") {
      return handleDesignRequest(request, env?.OPENROUTER_API_KEY);
    }
    if (url.pathname === "/api/music") {
      return handleMusicRequest(request, env?.MINIMAX_API_KEY, env?.MINIMAX_MUSIC_MODEL);
    }

    const pathname = url.pathname === "/" ? "/index.html" : url.pathname;
    const asset = assets.get(pathname);

    if (!asset) {
      return new Response("Not found", { status: 404 });
    }

    const headers = new Headers({
      "cache-control": pathname === "/index.html" ? "no-cache" : "public, max-age=31536000, immutable",
      "content-type": asset.contentType,
      // WebMCP rejects registerTool/getTools/executeTool with SecurityError unless the
      // agent cluster is origin-keyed, so without this the page exposes no tools at all.
      "origin-agent-cluster": "?1",
      "permissions-policy": "tools=(self)",
    });
    const body = request.method === "HEAD" ? null : decodeBase64(asset.body);
    return new Response(body, { headers });
  },
};
