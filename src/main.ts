import { mountApp } from "./ui/app";
import { bootWebMcp, registerTools, rememberLocal } from "./webmcp/adapter";
import { instrumentTools } from "./webmcp/tools";
import "./tailwind.css";
import "./style.css";

const tools = instrumentTools();
rememberLocal(tools);

const status = document.querySelector("#webmcp-status");

void (async () => {
  try {
    const ctx = await bootWebMcp();
    const count = ctx ? await registerTools(tools) : 0;
    if (status) {
      status.textContent =
        count > 0
          ? `WebMCP live · ${count} tools on this page`
          : "WebMCP native blocked · Studio Agent uses local tools";
    }
  } catch {
    if (status) status.textContent = "WebMCP native blocked · Studio Agent uses local tools";
  }
})();

mountApp();
