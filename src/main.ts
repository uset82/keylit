import { mountApp } from "./ui/app";
import { bootWebMcp, registerTools, rememberLocal } from "./webmcp/adapter";
import { instrumentTools } from "./webmcp/tools";

const tools = instrumentTools();
rememberLocal(tools);

const status = document.querySelector("#webmcp-status");

void (async () => {
  try {
    const ctx = await bootWebMcp();
    const count = ctx ? await registerTools(tools) : 0;
    // Short enough for one line: this now sits beside the arm button in the
    // rack, not across a full-width page header, and the old sentence wrapped
    // to four lines and shoved the button out of shape.
    if (status) {
      status.textContent = count > 0 ? `WebMCP live · ${count} tools` : "WebMCP · local tools";
    }
    if (import.meta.env.DEV) {
      const { mountCodexBridge } = await import("./dev/codex-bridge");
      mountCodexBridge();
    }
  } catch {
    if (status) status.textContent = "WebMCP · local tools";
    if (import.meta.env.DEV) {
      try {
        const { mountCodexBridge } = await import("./dev/codex-bridge");
        mountCodexBridge();
      } catch {
        // The page still teaches without Codex.
      }
    }
  }
})();

mountApp();
