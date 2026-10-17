import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import MyStoryProjects from "./MyStoryProjects";
import { createStoryProjectsClient, StoryProjectsError, type StoryProject } from "@/lib/api/story-projects";
import type { DevelopmentAuth } from "./development";
import { PasswordRecoveryError, type RecoveryState } from "./recovery";

const projects: StoryProject[] = [{
  id: "11111111-1111-4111-8111-111111111111", title: "Barndomens minnen", description: null,
  language: "sv", status: "draft", created_at: "2026-10-17T10:00:00Z", updated_at: "2026-10-17T10:00:00Z",
}];
let auth: DevelopmentAuth;
let signedOut: () => void;
let recoveryState: RecoveryState;
let recoveryListener: (state: RecoveryState) => void;
function changeRecovery(state: RecoveryState) { recoveryState = state; recoveryListener(state); }
const dispose = vi.fn();
beforeEach(() => {
  recoveryState = "none";
  auth = {
    signIn: vi.fn().mockResolvedValue(undefined), signOut: vi.fn().mockResolvedValue(undefined),
    getAccessToken: vi.fn().mockResolvedValue("synthetic-token"),
    onSignedOut: vi.fn(listener => { signedOut = listener; return dispose; }),
    getRecoveryState: () => recoveryState,
    onRecoveryChange: vi.fn(listener => { recoveryListener = listener; listener(recoveryState); return dispose; }),
    updatePassword: vi.fn().mockImplementation(async () => changeRecovery("complete")),
  };
});

describe("password recovery page", () => {
  const password = "Synthetic-New-Password-2048!";
  function renderRecovery(state: RecoveryState = "ready", loadProjects = vi.fn().mockResolvedValue([])) {
    recoveryState = state;
    render(<MyStoryProjects auth={auth} loadProjects={loadProjects} />);
    return loadProjects;
  }
  function submit(value = password, confirmation = value) {
    fireEvent.change(screen.getByLabelText("New Password"), { target: { value } });
    fireEvent.change(screen.getByLabelText("Confirm Password"), { target: { value: confirmation } });
    fireEvent.submit(screen.getByRole("form", { name: "Choose a new password" }));
  }
  it("shows a labelled, focused password form only after verified recovery, without login or projects", () => {
    const load = renderRecovery();
    expect(screen.getByLabelText("New Password")).toHaveFocus();
    for (const label of ["New Password", "Confirm Password"]) {
      expect(screen.getByLabelText(label)).toHaveAttribute("type", "password");
      expect(screen.getByLabelText(label)).toHaveAttribute("autocomplete", "new-password");
      expect(screen.getByLabelText(label)).toBeRequired();
    }
    expect(screen.getByLabelText("New Password")).toHaveAccessibleDescription(/Supabase checks those rules/);
    expect(screen.queryByRole("form", { name: "Sign in to development" })).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Your story projects" })).not.toBeInTheDocument();
    expect(load).not.toHaveBeenCalled();
  });
  it.each(["checking", "invalid"] as const)("never shows a password form for a %s link", state => {
    const load = renderRecovery(state);
    expect(screen.queryByLabelText("New Password")).not.toBeInTheDocument();
    expect(screen.getByRole(state === "invalid" ? "alert" : "status")).toHaveTextContent(state === "invalid" ? "invalid, expired, already used" : "Checking");
    expect(load).not.toHaveBeenCalled();
  });
  it("rejects mismatching passwords before the SDK, with an announced and focused error", async () => {
    renderRecovery(); submit(password, "different-synthetic-password");
    expect(await screen.findByRole("alert")).toHaveTextContent("passwords do not match");
    expect(screen.getByRole("alert")).toHaveFocus();
    expect(screen.getByLabelText("Confirm Password")).toHaveAttribute("aria-invalid", "true");
    expect(auth.updatePassword).not.toHaveBeenCalled();
  });
  it("rejects an empty password even if browser validation is bypassed", async () => {
    renderRecovery(); submit("", "");
    expect(await screen.findByRole("alert")).toHaveTextContent("Enter a new password");
    expect(auth.updatePassword).not.toHaveBeenCalled();
  });
  it("updates once, reports confirmed success, and returns to normal sign-in without loading projects", async () => {
    const load = renderRecovery(); submit();
    expect(await screen.findByRole("status")).toHaveTextContent("updated successfully");
    expect(auth.updatePassword).toHaveBeenCalledExactlyOnceWith(password);
    expect(screen.getByLabelText("Email")).toHaveFocus(); expect(screen.getByLabelText("Password")).toHaveValue("");
    expect(screen.queryByLabelText("New Password")).not.toBeInTheDocument(); expect(load).not.toHaveBeenCalled();
    vi.mocked(auth.signIn).mockImplementation(async () => changeRecovery("none"));
    signIn(); await waitFor(() => expect(load).toHaveBeenCalledTimes(1));
  });
  it("keeps failed updates private, clears password fields and allows retry", async () => {
    vi.mocked(auth.updatePassword).mockRejectedValueOnce(new Error(`synthetic-token ${password}`));
    const load = renderRecovery(); submit();
    expect(await screen.findByRole("alert")).toHaveTextContent("Could not update");
    expect(screen.getByRole("alert")).not.toHaveTextContent(password);
    expect(screen.queryByText(/synthetic-token/)).not.toBeInTheDocument();
    expect(screen.getByLabelText("New Password")).toHaveValue(""); expect(screen.getByLabelText("Confirm Password")).toHaveValue("");
    expect(load).not.toHaveBeenCalled(); submit();
    expect(await screen.findByRole("status")).toHaveTextContent("updated successfully");
  });
  it("shows safe project-policy guidance for a rejected weak password", async () => {
    vi.mocked(auth.updatePassword).mockRejectedValue(new PasswordRecoveryError("weak"));
    renderRecovery(); submit();
    expect(await screen.findByRole("alert")).toHaveTextContent("does not meet the development project's password rules");
  });
  it("disables duplicate submissions while saving and never requests projects", async () => {
    vi.mocked(auth.updatePassword).mockReturnValue(new Promise(() => {}));
    const load = renderRecovery(); submit();
    expect(screen.getByRole("form", { name: "Choose a new password" })).toHaveAttribute("aria-busy", "true");
    expect(screen.getByRole("button", { name: "Updating password…" })).toBeDisabled();
    expect(screen.getByLabelText("New Password")).toBeDisabled();
    fireEvent.submit(screen.getByRole("form", { name: "Choose a new password" }));
    expect(auth.updatePassword).toHaveBeenCalledTimes(1); expect(load).not.toHaveBeenCalled();
  });
  it("clears rows, aborts an existing read, and ignores late results when recovery begins", async () => {
    let resolve!: (value: StoryProject[]) => void;
    const load = vi.fn((_signal: AbortSignal) => new Promise<StoryProject[]>(done => { resolve = done; }));
    render(<MyStoryProjects auth={auth} loadProjects={load} />); signIn();
    await screen.findByText("Loading your story projects…");
    act(() => changeRecovery("ready"));
    expect(load.mock.calls[0][0].aborted).toBe(true);
    await act(async () => resolve(projects));
    expect(screen.queryByText(projects[0].title)).not.toBeInTheDocument();
    expect(screen.getByLabelText("New Password")).toBeVisible(); expect(load).toHaveBeenCalledTimes(1);
  });
  it("requires a clean reload instead of enabling sign-in if session cleanup fails", () => {
    const load = renderRecovery("cleanup-failed");
    expect(screen.getByRole("status")).toHaveTextContent("Your password was updated");
    expect(screen.getByRole("button", { name: "Reload to sign in" })).toBeVisible();
    expect(screen.queryByLabelText("Password")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("New Password")).not.toBeInTheDocument(); expect(load).not.toHaveBeenCalled();
  });
  it("ignores a pending sign-in failure when a recovery event has taken over the page", async () => {
    let reject!: (error: Error) => void;
    vi.mocked(auth.signIn).mockReturnValue(new Promise((_resolve, fail) => { reject = fail; }));
    const load = vi.fn(); render(<MyStoryProjects auth={auth} loadProjects={load} />); signIn();
    act(() => changeRecovery("ready"));
    await act(async () => reject(new Error("synthetic-private-password-token")));
    expect(screen.getByLabelText("New Password")).toBeVisible();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument(); expect(load).not.toHaveBeenCalled();
  });
});
function signIn() {
  fireEvent.change(screen.getByLabelText("Email"), { target: { value: "fake@example.invalid" } });
  fireEvent.change(screen.getByLabelText("Password"), { target: { value: "synthetic-password" } });
  fireEvent.submit(screen.getByRole("form", { name: "Sign in to development" }));
}

describe("development-only story project page", () => {
  it("starts signed out, with accessible labels and no project request", () => {
    const loadProjects = vi.fn(); render(<MyStoryProjects auth={auth} loadProjects={loadProjects} />);
    expect(screen.getByRole("heading", { level: 1, name: "My Story Projects" })).toBeVisible();
    expect(screen.getByLabelText("Email")).toHaveAttribute("autocomplete", "username");
    expect(screen.getByLabelText("Password")).toHaveAttribute("type", "password");
    expect(loadProjects).not.toHaveBeenCalled();
  });
  it("shows loading and then titles, languages and statuses without editing controls", async () => {
    let resolve!: (value: StoryProject[]) => void;
    const loadProjects = vi.fn(() => new Promise<StoryProject[]>(done => { resolve = done; }));
    render(<MyStoryProjects auth={auth} loadProjects={loadProjects} />); signIn();
    expect(await screen.findByRole("status")).toHaveTextContent("Loading");
    expect(screen.getByRole("region", { name: "Your story projects" })).toHaveAttribute("aria-busy", "true");
    await act(async () => resolve(projects));
    expect(screen.getByRole("heading", { level: 2, name: projects[0].title })).toBeVisible();
    expect(screen.getByText("Swedish (sv)")).toBeVisible(); expect(screen.getByText("draft")).toBeVisible();
    expect(screen.getByRole("status")).toHaveTextContent("Showing 1 story project");
    expect(screen.queryByRole("button", { name: /create|edit|delete/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });
  it("shows empty results", async () => {
    render(<MyStoryProjects auth={auth} loadProjects={vi.fn().mockResolvedValue([])} />); signIn();
    expect(await screen.findByRole("status")).toHaveTextContent("You have no story projects yet.");
  });
  it("connects the real API client to the page using the SDK token provider and a mocked HTTP response", async () => {
    const request = vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify(projects), { status: 200 }));
    const client = createStoryProjectsClient({ baseUrl: "http://127.0.0.1:8000/api/v1", getAccessToken: auth.getAccessToken, request });
    render(<MyStoryProjects auth={auth} loadProjects={client.list} />); signIn();
    expect(await screen.findByRole("heading", { name: projects[0].title })).toBeVisible();
    expect(auth.getAccessToken).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledExactlyOnceWith("http://127.0.0.1:8000/api/v1/story-projects", expect.objectContaining({
      method: "GET", headers: { Authorization: "Bearer synthetic-token", Accept: "application/json" },
    }));
  });
  it("does not make an HTTP request when the real API client cannot obtain a session token", async () => {
    vi.mocked(auth.getAccessToken).mockResolvedValue(null);
    const request = vi.fn();
    const client = createStoryProjectsClient({ baseUrl: "http://127.0.0.1:8000", getAccessToken: auth.getAccessToken, request });
    render(<MyStoryProjects auth={auth} loadProjects={client.list} />); signIn();
    expect(await screen.findByRole("alert")).toHaveTextContent("Please sign in again");
    expect(request).not.toHaveBeenCalled();
  });
  it("shows English and safely renders an HTML-looking title as text", async () => {
    const title = '<img src=x onerror="alert(1)">';
    const { container } = render(<MyStoryProjects auth={auth} loadProjects={vi.fn().mockResolvedValue([{ ...projects[0], title, language: "en" }])} />);
    signIn(); expect(await screen.findByRole("heading", { name: title })).toBeVisible();
    expect(screen.getByText("English (en)")).toBeVisible(); expect(container.querySelector("img")).toBeNull();
  });
  it("returns to sign-in and focuses email when authentication expires", async () => {
    render(<MyStoryProjects auth={auth} loadProjects={vi.fn().mockRejectedValue(new StoryProjectsError("authentication", 401))} />);
    signIn(); expect(await screen.findByRole("alert")).toHaveTextContent("Please sign in again");
    expect(screen.queryByRole("list")).not.toBeInTheDocument();
    expect(screen.getByLabelText("Email")).toHaveFocus();
  });
  it.each(["network", "backend", "unexpected"] as const)("shows a safe %s error and allows retry", async kind => {
    const loadProjects = vi.fn().mockRejectedValueOnce(new StoryProjectsError(kind)).mockResolvedValueOnce(projects);
    render(<MyStoryProjects auth={auth} loadProjects={loadProjects} />); signIn();
    expect(await screen.findByRole("alert")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByRole("heading", { name: projects[0].title })).toBeVisible();
    expect(loadProjects).toHaveBeenCalledTimes(2);
  });
  it("keeps sign-in failures private and does not request projects", async () => {
    vi.mocked(auth.signIn).mockRejectedValue(new Error("synthetic-password-private"));
    const loadProjects = vi.fn(); render(<MyStoryProjects auth={auth} loadProjects={loadProjects} />); signIn();
    expect(await screen.findByRole("alert")).not.toHaveTextContent("synthetic-password-private");
    expect(screen.getByLabelText("Password")).toHaveValue(""); expect(loadProjects).not.toHaveBeenCalled();
  });
  it("clears private rows when signing out", async () => {
    render(<MyStoryProjects auth={auth} loadProjects={vi.fn().mockResolvedValue(projects)} />); signIn();
    await screen.findByRole("heading", { name: projects[0].title }); fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
    await waitFor(() => expect(screen.getByLabelText("Password")).toBeVisible());
    expect(screen.getByLabelText("Email")).toHaveFocus();
    expect(screen.queryByText(projects[0].title)).not.toBeInTheDocument(); expect(auth.signOut).toHaveBeenCalledTimes(1);
  });
  it("cancels in-flight reads and ignores late results after an SDK sign-out", async () => {
    let resolve!: (value: StoryProject[]) => void;
    const loadProjects = vi.fn((_signal: AbortSignal) => new Promise<StoryProject[]>(done => { resolve = done; }));
    render(<MyStoryProjects auth={auth} loadProjects={loadProjects} />); signIn();
    await screen.findByText("Loading your story projects…");
    act(() => signedOut());
    expect(loadProjects.mock.calls[0][0].aborted).toBe(true);
    await act(async () => resolve(projects));
    expect(screen.queryByText(projects[0].title)).not.toBeInTheDocument();
    expect(screen.getByLabelText("Email")).toBeVisible();
  });
  it("aborts reads and removes auth listeners on unmount", async () => {
    const loadProjects = vi.fn((_signal: AbortSignal) => new Promise<StoryProject[]>(() => {}));
    const view = render(<MyStoryProjects auth={auth} loadProjects={loadProjects} />); signIn();
    await screen.findByText("Loading your story projects…"); view.unmount();
    expect(loadProjects.mock.calls[0][0].aborted).toBe(true); expect(dispose).toHaveBeenCalled();
  });
});
