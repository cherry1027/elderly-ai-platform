export interface StoryProject {
  id: string;
  title: string;
  description: string | null;
  language: "en" | "sv";
  status: string;
  created_at: string;
  updated_at: string;
}

type ErrorKind = "configuration" | "authentication" | "network" | "backend" | "unexpected";

const messages: Record<ErrorKind, string> = {
  configuration: "Check the development page configuration in the setup guide.",
  authentication: "Your development session has expired. Please sign in again.",
  network: "The development backend could not be reached. Check that it is running and try again.",
  backend: "The development backend could not load your projects. Please try again.",
  unexpected: "The development backend returned an unexpected response. Please try again.",
};

export class StoryProjectsError extends Error {
  constructor(public readonly kind: ErrorKind, public readonly status?: number) {
    super(messages[kind]);
    this.name = "StoryProjectsError";
  }
}

/** The configured base may be the origin or end in /api/v1, never both twice. */
export function storyProjectsUrl(baseUrl: string): string {
  let url: URL;
  try { url = new URL(baseUrl); } catch { throw new StoryProjectsError("configuration"); }
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  const path = url.pathname.replace(/\/+$/, "");
  if ((url.protocol !== "https:" && !(url.protocol === "http:" && local)) ||
      url.username || url.password || url.search || url.hash ||
      !["", "/api/v1"].includes(path)) {
    throw new StoryProjectsError("configuration");
  }
  return `${url.origin}/api/v1/story-projects`;
}

function isProject(value: unknown): value is StoryProject {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  const date = (v: unknown) => typeof v === "string" &&
    /^\d{4}-\d{2}-\d{2}T.+(?:Z|[+-]\d{2}:\d{2})$/.test(v) && Number.isFinite(Date.parse(v));
  return typeof row.id === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(row.id) &&
    typeof row.title === "string" &&
    (row.description === null || typeof row.description === "string") &&
    (row.language === "en" || row.language === "sv") &&
    typeof row.status === "string" && date(row.created_at) && date(row.updated_at);
}

/** No React, storage, Supabase SDK or environment access; reusable with another token provider. */
export function createStoryProjectsClient({
  baseUrl,
  getAccessToken,
  request = globalThis.fetch,
  timeoutMs = 10_000,
}: {
  baseUrl: string;
  getAccessToken: () => Promise<string | null>;
  request?: typeof fetch;
  timeoutMs?: number;
}) {
  const url = storyProjectsUrl(baseUrl);

  return {
    async list(signal?: AbortSignal): Promise<StoryProject[]> {
      let token: string | null;
      try { token = await getAccessToken(); } catch { throw new StoryProjectsError("authentication"); }
      if (!token || /\s/.test(token)) throw new StoryProjectsError("authentication");

      const controller = new AbortController();
      const abort = () => controller.abort();
      signal?.addEventListener("abort", abort, { once: true });
      if (signal?.aborted) controller.abort();
      const timer = setTimeout(abort, timeoutMs);
      try {
        let response: Response;
        try {
          response = await request(url, {
            method: "GET",
            headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
            credentials: "omit", cache: "no-store", redirect: "error", signal: controller.signal,
          });
        } catch (error) {
          if (signal?.aborted) throw error;
          throw new StoryProjectsError("network");
        }
        if (response.status === 401) throw new StoryProjectsError("authentication", 401);
        // Do not show upstream messages/bodies, which could contain private input.
        if (!response.ok) throw new StoryProjectsError("backend", response.status);
        if (response.status !== 200) throw new StoryProjectsError("unexpected");
        let data: unknown;
        try { data = await response.json(); } catch { throw new StoryProjectsError("unexpected"); }
        if (!Array.isArray(data) || data.length > 50 || !data.every(isProject)) {
          throw new StoryProjectsError("unexpected");
        }
        return data.map(({ id, title, description, language, status, created_at, updated_at }) =>
          ({ id, title, description, language, status, created_at, updated_at }));
      } finally {
        clearTimeout(timer);
        signal?.removeEventListener("abort", abort);
      }
    },
  };
}
