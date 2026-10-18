import { act, fireEvent, render, screen } from "@testing-library/react";
import { isValidElement, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Entrance from "./Entrance";
import { applicationTarget, startApplication } from "./bootstrap";
import { COMPLETION_KEY } from "../features/onboarding/onboarding-state";

const EntranceStub = () => <main>Entrance loaded</main>;
const LegacyStub = () => <main>Preserved application loaded</main>;
let navigationListeners: { type: string; listener: EventListenerOrEventListenerObject; capture: boolean }[] = [];

function loaders() {
  return {
    loadEntrance: vi.fn(async () => ({ default: EntranceStub })),
    loadLegacy: vi.fn(async () => ({ default: LegacyStub })),
  };
}

function renderingRoot() {
  const element = document.createElement("div");
  document.body.append(element);
  const root = {
    render: vi.fn((node: ReactNode) => { render(node, { container: element }); }),
  };
  return { element, root, createApplicationRoot: vi.fn(() => root) };
}

beforeEach(() => {
  window.history.replaceState(null, "", "/");
  navigationListeners = [];
  const addListener = window.addEventListener.bind(window);
  vi.spyOn(window, "addEventListener").mockImplementation((type, listener, options) => {
    if (type === "popstate" || type === "hashchange") {
      navigationListeners.push({ type, listener, capture: typeof options === "boolean" ? options : options?.capture ?? false });
    }
    addListener(type, listener, options);
  });
});

afterEach(() => {
  for (const { type, listener, capture } of navigationListeners) {
    window.removeEventListener(type, listener, capture);
  }
});

describe("application bootstrap chooses the preserved route before loading application code", () => {
  it.each([
    "/",
    "/index.html",
    "/?utm_source=invitation&language=sv",
    "/?campaign=family&type=book#chapter-three",
    "/index.html#our-story",
  ])("loads only the entrance for an ordinary root visit: %s", async (url) => {
    window.history.replaceState(null, "", url);
    const before = window.location.href;
    const loading = loaders();
    const mounting = renderingRoot();

    await startApplication({ ...loading, ...mounting });

    expect(applicationTarget(window.location)).toBe("entrance");
    expect(loading.loadEntrance).toHaveBeenCalledExactlyOnceWith();
    expect(loading.loadLegacy).not.toHaveBeenCalled();
    expect(screen.getByText("Entrance loaded")).toBeVisible();
    expect(window.location.href).toBe(before);
    expect(mounting.createApplicationRoot).toHaveBeenCalledExactlyOnceWith(mounting.element);
  });

  it.each([
    "/?code=synthetic-code",
    "/?token_hash=synthetic-hash&type=recovery",
    "/?error=access_denied&error_description=synthetic-description",
    "/index.html#access_token=synthetic-access&refresh_token=synthetic-refresh&type=recovery",
    "/#type=recovery",
    "/auth?redirect=dashboard",
    "/auth/callback?code=synthetic-code",
    "/reset-password#type=recovery",
    "/story-projects.html#access_token=synthetic-access&type=recovery",
    "/dashboard?view=stories",
    "/story/synthetic-project",
    "/unknown/deep-link",
  ])("loads only the preserved application for a callback or deep link: %s", async (url) => {
    window.history.replaceState(null, "", url);
    window.localStorage.setItem(COMPLETION_KEY, "complete");
    const before = window.location.href;
    const read = vi.spyOn(Storage.prototype, "getItem");
    const write = vi.spyOn(Storage.prototype, "setItem");
    const loading = loaders();
    const mounting = renderingRoot();

    await startApplication({ ...loading, ...mounting });

    expect(applicationTarget(window.location)).toBe("legacy");
    expect(loading.loadLegacy).toHaveBeenCalledExactlyOnceWith();
    expect(loading.loadEntrance).not.toHaveBeenCalled();
    expect(screen.getByText("Preserved application loaded")).toBeVisible();
    expect(screen.queryByText(/synthetic-(code|hash|description|access|refresh)/)).not.toBeInTheDocument();
    expect(window.location.href).toBe(before);
    expect(read).not.toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();
    // The loader receives no URL/token arguments, and the component gets no props.
    const rendered = mounting.root.render.mock.calls[0][0];
    expect(isValidElement(rendered)).toBe(true);
    if (isValidElement(rendered)) {
      expect(rendered.type).toBe(LegacyStub);
      expect(rendered.props).toEqual({});
    }
  });

  it("does not load or create a root if its mount element is absent", async () => {
    const loading = loaders();
    const createApplicationRoot = vi.fn();
    const getLocation = vi.fn(() => window.location);

    await startApplication({ element: null, ...loading, createApplicationRoot, getLocation });

    expect(createApplicationRoot).not.toHaveBeenCalled();
    expect(getLocation).not.toHaveBeenCalled();
    expect(loading.loadEntrance).not.toHaveBeenCalled();
    expect(loading.loadLegacy).not.toHaveBeenCalled();
  });
});

describe("loading races and failures", () => {
  it("prioritizes a callback arriving while the entrance chunk is loading", async () => {
    let releaseEntrance!: (module: { default: typeof EntranceStub }) => void;
    const loadEntrance = vi.fn(() => new Promise<{ default: typeof EntranceStub }>(resolve => {
      releaseEntrance = resolve;
    }));
    const loadLegacy = vi.fn(async () => ({ default: LegacyStub }));
    const mounting = renderingRoot();
    const write = vi.spyOn(Storage.prototype, "setItem");
    const pending = startApplication({ loadEntrance, loadLegacy, ...mounting });

    window.history.replaceState(null, "", "/#access_token=synthetic-access&type=recovery");
    const callbackUrl = window.location.href;
    releaseEntrance({ default: EntranceStub });
    await pending;

    expect(loadLegacy).toHaveBeenCalledExactlyOnceWith();
    expect(screen.getByText("Preserved application loaded")).toBeVisible();
    expect(screen.queryByText("Entrance loaded")).not.toBeInTheDocument();
    expect(window.location.href).toBe(callbackUrl);
    expect(write).not.toHaveBeenCalled();
  });

  it("uses a generic inert error if locations keep changing during chunk loading", async () => {
    let current = { pathname: "/", search: "", hash: "" };
    const loadEntrance = vi.fn(async () => {
      current = { pathname: "/", search: "?code=synthetic-secret", hash: "" };
      return { default: EntranceStub };
    });
    const loadLegacy = vi.fn(async () => {
      current = { pathname: "/index.html", search: "", hash: "" };
      return { default: LegacyStub };
    });
    const mounting = renderingRoot();
    const write = vi.spyOn(Storage.prototype, "setItem");

    await startApplication({ ...mounting, loadEntrance, loadLegacy, getLocation: () => current });

    expect(screen.getByRole("alert")).toHaveTextContent("Memy could not open this page. Reload the page to try again.");
    expect(document.body.textContent).not.toContain("synthetic-secret");
    expect(screen.queryByText("Entrance loaded")).not.toBeInTheDocument();
    expect(screen.queryByText("Preserved application loaded")).not.toBeInTheDocument();
    expect(loadEntrance).toHaveBeenCalledTimes(1);
    expect(loadLegacy).toHaveBeenCalledTimes(1);
    expect(write).not.toHaveBeenCalled();
  });

  it.each(["entrance", "legacy"] as const)("sanitizes a failing %s loader without logging its error", async target => {
    if (target === "legacy") window.history.replaceState(null, "", "/?code=synthetic-code");
    const before = window.location.href;
    const failed = vi.fn(async () => { throw new Error("synthetic-secret callback https://invalid.example/?token=synthetic-token"); });
    const loading = loaders();
    const mounting = renderingRoot();
    const error = vi.spyOn(console, "error");
    const warn = vi.spyOn(console, "warn");
    const log = vi.spyOn(console, "log");
    const write = vi.spyOn(Storage.prototype, "setItem");

    await startApplication({
      ...loading, ...mounting,
      ...(target === "entrance" ? { loadEntrance: failed } : { loadLegacy: failed }),
    });

    expect(screen.getByRole("heading", { name: "Memy" })).toBeVisible();
    expect(screen.getByRole("alert")).toHaveTextContent("Reload the page to try again.");
    expect(document.body.textContent).not.toMatch(/synthetic-|invalid\.example/);
    expect(failed).toHaveBeenCalledExactlyOnceWith();
    expect(error).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
    expect(log).not.toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();
    expect(window.location.href).toBe(before);
  });
});

describe("navigation arriving after the entrance has mounted", () => {
  it.each([
    { url: "/#access_token=synthetic-access&type=recovery", event: "hashchange" },
    { url: "/?code=synthetic-code", event: "popstate" },
    { url: "/dashboard?view=stories", event: "popstate" },
  ])("hands off a late $event navigation to the preserved application", async ({ url, event }) => {
    const mounting = renderingRoot();
    const loadEntrance = vi.fn(async () => ({ default: Entrance }));
    const loadLegacy = vi.fn(async () => ({ default: LegacyStub }));
    await act(async () => { await startApplication({ ...mounting, loadEntrance, loadLegacy }); });
    expect(screen.getByRole("heading", { name: "Every life has a story." })).toBeVisible();
    const write = vi.spyOn(Storage.prototype, "setItem");

    await act(async () => {
      window.history.replaceState(null, "", url);
      window.dispatchEvent(new Event(event));
    });

    expect(loadLegacy).toHaveBeenCalledExactlyOnceWith();
    expect(loadEntrance).toHaveBeenCalledExactlyOnceWith();
    expect(screen.getByText("Preserved application loaded")).toBeVisible();
    expect(screen.queryByRole("heading", { name: "Every life has a story." })).not.toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/synthetic-(code|access)/);
    expect(`${window.location.pathname}${window.location.search}${window.location.hash}`).toBe(url);
    expect(write).not.toHaveBeenCalled();
    expect(mounting.createApplicationRoot).toHaveBeenCalledTimes(1);
  });

  it("keeps ordinary query and section navigation in the entrance", async () => {
    const loading = loaders();
    const mounting = renderingRoot();
    await startApplication({ ...mounting, ...loading });

    await act(async () => {
      window.history.replaceState(null, "", "/?utm_source=family&type=book");
      window.dispatchEvent(new PopStateEvent("popstate"));
      window.history.replaceState(null, "", "/?utm_source=family&type=book#chapter-three");
      window.dispatchEvent(new HashChangeEvent("hashchange"));
    });

    expect(loading.loadLegacy).not.toHaveBeenCalled();
    expect(loading.loadEntrance).toHaveBeenCalledExactlyOnceWith();
    expect(mounting.root.render).toHaveBeenCalledTimes(1);
    expect(screen.getByText("Entrance loaded")).toBeVisible();
  });

  it("does not start duplicate legacy loads for repeated callback events", async () => {
    let releaseLegacy!: (module: { default: typeof LegacyStub }) => void;
    const loadLegacy = vi.fn(() => new Promise<{ default: typeof LegacyStub }>(resolve => {
      releaseLegacy = resolve;
    }));
    const loading = loaders();
    const mounting = renderingRoot();
    await startApplication({ ...loading, ...mounting, loadLegacy });

    await act(async () => {
      window.history.replaceState(null, "", "/#type=recovery&access_token=synthetic-access");
      window.dispatchEvent(new HashChangeEvent("hashchange"));
      window.dispatchEvent(new PopStateEvent("popstate"));
      window.dispatchEvent(new HashChangeEvent("hashchange"));
      expect(loadLegacy).toHaveBeenCalledTimes(1);
      releaseLegacy({ default: LegacyStub });
    });

    expect(loadLegacy).toHaveBeenCalledExactlyOnceWith();
    expect(mounting.root.render).toHaveBeenCalledTimes(2);
    expect(screen.getByText("Preserved application loaded")).toBeVisible();
    await act(async () => { window.dispatchEvent(new PopStateEvent("popstate")); });
    expect(loadLegacy).toHaveBeenCalledTimes(1);
  });

  it("remounts a fresh entrance if a pending callback navigation returns to the root", async () => {
    let releaseLegacy!: (module: { default: typeof LegacyStub }) => void;
    const loadLegacy = vi.fn(() => new Promise<{ default: typeof LegacyStub }>(resolve => {
      releaseLegacy = resolve;
    }));
    const loadEntrance = vi.fn(async () => ({ default: Entrance }));
    const mounting = renderingRoot();
    await act(async () => { await startApplication({ ...mounting, loadEntrance, loadLegacy }); });
    const write = vi.spyOn(Storage.prototype, "setItem");

    await act(async () => {
      window.history.replaceState(null, "", "/#type=recovery&access_token=synthetic-access");
      window.dispatchEvent(new HashChangeEvent("hashchange"));
    });
    expect(screen.getByRole("heading", { name: "Continue your sign-in safely." })).toBeVisible();

    await act(async () => {
      window.history.replaceState(null, "", "/");
      window.dispatchEvent(new PopStateEvent("popstate"));
      releaseLegacy({ default: LegacyStub });
    });

    expect(screen.getByRole("heading", { name: "Every life has a story." })).toBeVisible();
    expect(screen.queryByRole("heading", { name: "Continue your sign-in safely." })).not.toBeInTheDocument();
    expect(screen.queryByText("Preserved application loaded")).not.toBeInTheDocument();
    expect(loadEntrance).toHaveBeenCalledTimes(2);
    expect(loadLegacy).toHaveBeenCalledExactlyOnceWith();
    expect(mounting.createApplicationRoot).toHaveBeenCalledTimes(1);
    expect(write).not.toHaveBeenCalled();
    expect(window.localStorage.getItem(COMPLETION_KEY)).toBeNull();
  });
});

describe("the real entrance mounts at the application's actual root", () => {
  it("shows the real first-visit UI without importing the legacy application", async () => {
    const mounting = renderingRoot();
    const loadEntrance = vi.fn(async () => ({ default: Entrance }));
    const loadLegacy = vi.fn(async () => ({ default: LegacyStub }));

    await act(async () => { await startApplication({ ...mounting, loadEntrance, loadLegacy }); });

    expect(screen.getByRole("heading", { level: 1, name: "Every life has a story." })).toBeVisible();
    expect(screen.queryByText("Development preview")).not.toBeInTheDocument();
    expect(loadLegacy).not.toHaveBeenCalled();
    expect(window.localStorage.getItem(COMPLETION_KEY)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByRole("heading", { name: "Speak at your own pace." })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Skip" }));
    expect(screen.getByRole("heading", { name: "Welcome to Memy." })).toBeVisible();
    expect(window.localStorage.getItem(COMPLETION_KEY)).toBe("complete");
    expect(window.location.pathname).toBe("/");
  });

  it("bypasses completed onboarding and keeps all welcome destinations disabled", async () => {
    window.history.replaceState(null, "", "/index.html?utm_source=family");
    window.localStorage.setItem(COMPLETION_KEY, "complete");
    const mounting = renderingRoot();
    const loading = loaders();

    await act(async () => {
      await startApplication({ ...mounting, ...loading, loadEntrance: async () => ({ default: Entrance }) });
    });

    expect(screen.getByRole("heading", { name: "Welcome to Memy." })).toBeVisible();
    expect(screen.getByText("Sign-in, account creation and guest access are coming soon.")).toBeVisible();
    for (const name of ["Log in", "Create Account", "Continue as Guest"]) {
      const control = screen.getByRole("button", { name });
      expect(control).toBeDisabled();
      fireEvent.click(control);
    }
    expect(window.location.pathname).toBe("/index.html");
    expect(window.location.search).toBe("?utm_source=family");
    expect(loading.loadLegacy).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Replay Introduction" }));
    expect(screen.getByRole("heading", { name: "Every life has a story." })).toBeVisible();
    expect(window.localStorage.getItem(COMPLETION_KEY)).toBe("complete");
  });
});
