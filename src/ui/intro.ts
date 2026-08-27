/**
 * The optional songs-and-lessons picker. The playable keybed is the landing
 * surface; this panel is opened only when someone asks to browse lessons.
 * `arm` runs on the way out so choosing a lesson can also unlock audio.
 */
export const mountIntro = (arm: () => void): void => {
  const intro = document.querySelector<HTMLElement>("#intro");
  if (!intro) return;

  const close = (): void => {
    if (intro.classList.contains("hidden")) return;
    intro.classList.add("hidden");
    arm();
  };

  const open = (): void => {
    intro.classList.remove("hidden");
    intro.scrollTop = 0;
  };

  // The initial markup is already hidden to avoid flashing the picker before
  // JavaScript starts. It remains available from the Songs button.
  intro.classList.add("hidden");

  document.querySelector("#intro-start")?.addEventListener("click", close);
  document.querySelector("#intro-close-btn")?.addEventListener("click", close);
  // Picking a lesson counts as starting: the [data-recipe] handler in app.ts
  // still fires and runs the agent turn, so the lesson is already loading.
  intro.querySelectorAll<HTMLElement>("[data-recipe]").forEach((tile) => {
    tile.addEventListener("click", close);
  });
  // Teaching reveals the tier list, so the overlay has to stay up. DJ mode has
  // nothing left to pick here — its controls are the STUDIO drawer behind this
  // card — so picking it goes straight through. mountMode sets the mode itself.
  intro.querySelector<HTMLElement>('[data-mode-pick="dj"]')?.addEventListener("click", close);
  document.querySelectorAll<HTMLElement>("[data-intro-open]").forEach((button) => {
    button.addEventListener("click", open);
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !intro.classList.contains("hidden")) close();
  });
};
