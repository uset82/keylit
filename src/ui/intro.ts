/**
 * KEYLIT's main landing screen. It introduces the lesson library first, then
 * hands the page to the keybed when someone starts playing. `arm` runs on the
 * way out so that first gesture can also unlock audio.
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

  document.querySelector("#intro-start")?.addEventListener("click", close);
  document.querySelector("#intro-close-btn")?.addEventListener("click", close);
  // Picking a lesson or DJ feature counts as starting: the [data-recipe] handler in app.ts
  // still fires and runs the agent turn, so the feature/lesson is already loading.
  intro.querySelectorAll<HTMLElement>("[data-recipe]").forEach((tile) => {
    tile.addEventListener("click", close);
  });
  document.querySelectorAll<HTMLElement>("[data-intro-open]").forEach((button) => {
    button.addEventListener("click", open);
  });
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && !intro.classList.contains("hidden")) close();
  });
};
