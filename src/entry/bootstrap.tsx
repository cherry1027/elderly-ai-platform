import { createRoot, type Root } from "react-dom/client";
import type { ComponentType } from "react";
import { isAuthenticationCallback, isEntrancePath } from "../features/onboarding/onboarding-state";

type LocationShape = Pick<Location, "pathname" | "search" | "hash">;
type ApplicationModule = { default: ComponentType };
type Target = "entrance" | "legacy";

interface BootstrapOptions {
  element?: HTMLElement | null;
  getLocation?: () => LocationShape;
  loadEntrance?: () => Promise<ApplicationModule>;
  loadLegacy?: () => Promise<ApplicationModule>;
  createApplicationRoot?: (element: HTMLElement) => Pick<Root, "render">;
}

export function applicationTarget(location: LocationShape): Target {
  return isEntrancePath(location.pathname) && !isAuthenticationCallback(location)
    ? "entrance" : "legacy";
}

export async function startApplication({
  element = document.getElementById("root"),
  getLocation = () => window.location,
  loadEntrance = () => import("./Entrance"),
  loadLegacy = () => import("./LegacyApplication"),
  createApplicationRoot = createRoot,
}: BootstrapOptions = {}): Promise<void> {
  if (!element) return;
  const root = createApplicationRoot(element);
  let generation = 0;
  async function openApplication() {
    try {
      const loaders = { entrance: loadEntrance, legacy: loadLegacy };
      let target = applicationTarget(getLocation());
      let application = await loaders[target]();
      // A callback/deep link arriving while the entrance chunk loads takes
      // precedence. No URL or credential is passed to the loaded component.
      if (applicationTarget(getLocation()) !== target) {
        target = applicationTarget(getLocation());
        application = await loaders[target]();
      }
      if (applicationTarget(getLocation()) !== target) {
        throw new Error("Application location changed during loading.");
      }
      const Application = application.default;
      // A changed URL must not reuse a previous entrance's sticky callback state.
      root.render(<Application key={++generation} />);
      if (target === "entrance") {
        // Preserve auth and deep-link navigation that arrives after the entrance
        // mounts, as well as callbacks present during the initial page load.
        const handOff = () => {
          if (applicationTarget(getLocation()) !== "legacy") return;
          window.removeEventListener("popstate", handOff);
          window.removeEventListener("hashchange", handOff);
          void openApplication();
        };
        window.addEventListener("popstate", handOff);
        window.addEventListener("hashchange", handOff);
      }
    } catch {
      // Never render or log module errors: they may contain callback URL data.
      root.render(<main style={{ padding: "2rem", fontFamily: "system-ui", fontSize: "20px" }}>
        <h1>Memy</h1>
        <p role="alert">Memy could not open this page. Reload the page to try again.</p>
      </main>);
    }
  }
  await openApplication();
}
