import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, beforeEach, expect, vi } from "vitest";

// Configuration tests run in Node; UI tests alone need browser/device guards.
if (typeof window !== "undefined") {
  const blockedMessage = "Network and device access are blocked in isolated onboarding tests.";
  const blocked = () => { throw new Error(blockedMessage); };
  const fetchGuard = vi.fn(blocked);
  const xhrGuard = vi.fn(function () { blocked(); });
  const socketGuard = vi.fn(function () { blocked(); });
  const streamGuard = vi.fn(function () { blocked(); });
  const beaconGuard = vi.fn(blocked);
  const microphoneGuard = vi.fn(blocked);

  // Install guards before component imports; this preview must never contact a service.
  vi.stubGlobal("fetch", fetchGuard);
  vi.stubGlobal("XMLHttpRequest", xhrGuard);
  vi.stubGlobal("WebSocket", socketGuard);
  vi.stubGlobal("EventSource", streamGuard);
  Object.defineProperty(navigator, "sendBeacon", { configurable: true, value: beaconGuard });
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: { getUserMedia: microphoneGuard },
  });
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: vi.fn((query: string): MediaQueryList => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(() => true),
    })),
  });

  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
    window.history.replaceState(null, "", "/onboarding-review.html");
    document.documentElement.lang = "en";
  });

  afterEach(() => {
    cleanup();
    const guards = [fetchGuard, xhrGuard, socketGuard, streamGuard, beaconGuard, microphoneGuard];
    try {
      for (const guard of guards) expect(guard).not.toHaveBeenCalled();
    } finally {
      vi.restoreAllMocks();
    }
  });
}
