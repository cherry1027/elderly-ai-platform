import { afterEach, beforeEach, expect, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const http: typeof import("node:http") = require("node:http");
const https: typeof import("node:https") = require("node:https");
const net: typeof import("node:net") = require("node:net");

beforeEach(() => {
  const deny = () => { throw new Error("Real network access is forbidden in story-project tests"); };
  vi.stubGlobal("fetch", vi.fn(deny));
  vi.spyOn(http, "request").mockImplementation(deny as typeof http.request);
  vi.spyOn(http, "get").mockImplementation(deny as typeof http.get);
  vi.spyOn(https, "request").mockImplementation(deny as typeof https.request);
  vi.spyOn(https, "get").mockImplementation(deny as typeof https.get);
  vi.spyOn(net.Socket.prototype, "connect").mockImplementation(deny as typeof net.Socket.prototype.connect);
});

afterEach(() => {
  cleanup();
  expect(globalThis.fetch).not.toHaveBeenCalled();
  expect(http.request).not.toHaveBeenCalled();
  expect(http.get).not.toHaveBeenCalled();
  expect(https.request).not.toHaveBeenCalled();
  expect(https.get).not.toHaveBeenCalled();
  expect(net.Socket.prototype.connect).not.toHaveBeenCalled();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
