// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { createStoryProjectsClient, StoryProjectsError, storyProjectsUrl } from "./story-projects";

const token = "synthetic-user-access-token";
const project = {
  id: "11111111-1111-4111-8111-111111111111", title: "My memories", description: null,
  language: "en", status: "draft", created_at: "2026-10-17T10:00:00Z", updated_at: "2026-10-17T10:00:00+00:00",
};
function harness(body: unknown = [project], status = 200) {
  const request = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify(body), { status }));
  const getAccessToken = vi.fn(async (): Promise<string | null> => token);
  return { request, getAccessToken, client: createStoryProjectsClient({ baseUrl: "http://127.0.0.1:8000", getAccessToken, request }) };
}
afterEach(() => vi.useRealTimers());

describe("read-only story-project client", () => {
  it.each(["http://127.0.0.1:8000", "http://127.0.0.1:8000/", "http://127.0.0.1:8000/api/v1", "http://127.0.0.1:8000/api/v1/"])("normalizes %s without duplicating the API prefix", base => {
    expect(storyProjectsUrl(base)).toBe("http://127.0.0.1:8000/api/v1/story-projects");
  });
  it.each(["", "not-a-url", "http://remote.example.invalid", "http://user:pass@localhost:8000", "http://localhost:8000?token=private", "http://localhost:8000/#token", "http://localhost:8000/api/v1/api/v1"])("rejects unsafe or ambiguous base %s", base => {
    expect(() => storyProjectsUrl(base)).toThrow(StoryProjectsError);
  });
  it("uses GET and the current SDK-provided token with no cookies, cache or redirects", async () => {
    const h = harness();
    expect(await h.client.list()).toEqual([project]);
    expect(h.getAccessToken).toHaveBeenCalledTimes(1);
    expect(h.request).toHaveBeenCalledExactlyOnceWith("http://127.0.0.1:8000/api/v1/story-projects", expect.objectContaining({
      method: "GET", headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      credentials: "omit", cache: "no-store", redirect: "error", signal: expect.any(AbortSignal),
    }));
    expect(h.request.mock.calls[0][1]).not.toHaveProperty("body");
  });
  it("accepts an empty list", async () => { expect(await harness([]).client.list()).toEqual([]); });
  it("gets a fresh token for every request", async () => {
    const h = harness(); h.getAccessToken.mockResolvedValueOnce("first-fake-token").mockResolvedValueOnce("second-fake-token");
    await h.client.list(); await h.client.list();
    expect(h.request.mock.calls.map(call => (call[1] as RequestInit).headers)).toEqual([
      { Authorization: "Bearer first-fake-token", Accept: "application/json" },
      { Authorization: "Bearer second-fake-token", Accept: "application/json" },
    ]);
  });
  it.each([null, "", "token with spaces"])("makes no request without a usable token (%s)", async value => {
    const h = harness(); h.getAccessToken.mockResolvedValue(value);
    await expect(h.client.list()).rejects.toMatchObject({ kind: "authentication" });
    expect(h.request).not.toHaveBeenCalled();
  });
  it("sanitizes a failed token provider before any HTTP request", async () => {
    const h = harness(); h.getAccessToken.mockRejectedValue(new Error(token));
    await expect(h.client.list()).rejects.toMatchObject({ kind: "authentication" });
    expect(h.request).not.toHaveBeenCalled();
  });
  it("handles 401 without a fallback key or automatic retry", async () => {
    const h = harness({ error: { code: "INVALID_ACCESS_TOKEN", message: token } }, 401);
    await expect(h.client.list()).rejects.toMatchObject({ kind: "authentication", status: 401 });
    expect(h.request).toHaveBeenCalledTimes(1);
  });
  it.each([403, 404, 409, 422, 500, 503])("handles HTTP %s without showing the raw body", async status => {
    const h = harness({ error: { code: "SUPABASE_UNAVAILABLE", message: token } }, status);
    await expect(h.client.list()).rejects.toMatchObject({ kind: "backend", status });
    await expect(h.client.list()).rejects.not.toThrow(token);
  });
  it("sanitizes network failures", async () => {
    const h = harness(); h.request.mockRejectedValue(new Error(token));
    await expect(h.client.list()).rejects.toMatchObject({ kind: "network" });
    await expect(h.client.list()).rejects.not.toThrow(token);
  });
  it.each([null, {}, { projects: [project] }, [{ ...project, id: "bad" }], [{ ...project, language: "de" }],
    [{ ...project, description: 123 }], [{ ...project, status: 123 }], [{ ...project, updated_at: "yesterday" }],
    [{ title: "Incomplete" }], Array.from({ length: 51 }, () => project)])("rejects unexpected response data %#", async body => {
    await expect(harness(body).client.list()).rejects.toMatchObject({ kind: "unexpected" });
  });
  it("rejects invalid JSON", async () => {
    const h = harness(); h.request.mockResolvedValue(new Response("<html>not JSON</html>", { status: 200 }));
    await expect(h.client.list()).rejects.toMatchObject({ kind: "unexpected" });
  });
  it("requires the documented 200 response", async () => {
    await expect(harness([project], 201).client.list()).rejects.toMatchObject({ kind: "unexpected" });
  });
  it("drops extra fields rather than exposing them to consumers", async () => {
    expect(await harness([{ ...project, private_extra: token }]).client.list()).toEqual([project]);
  });
  it("aborts an unresponsive backend after ten seconds", async () => {
    vi.useFakeTimers();
    const request = vi.fn((_url: RequestInfo | URL, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init!.signal!.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
    }));
    const client = createStoryProjectsClient({ baseUrl: "http://localhost:8000", getAccessToken: async () => token, request });
    const assertion = expect(client.list()).rejects.toMatchObject({ kind: "network" });
    await vi.advanceTimersByTimeAsync(10_000);
    await assertion;
  });
  it("propagates caller cancellation", async () => {
    const h = harness(); const controller = new AbortController();
    h.request.mockImplementation(async (_url, init) => {
      expect(init!.signal!.aborted).toBe(true); throw new DOMException("aborted", "AbortError");
    });
    controller.abort();
    await expect(h.client.list(controller.signal)).rejects.toMatchObject({ name: "AbortError" });
  });
});
