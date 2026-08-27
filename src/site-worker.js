const assets = new Map(/*__SITES_ASSETS__*/);

function decodeBase64(value) {
  const binary = atob(value);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

export default {
  async fetch(request) {
    const url = new URL(request.url);
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
