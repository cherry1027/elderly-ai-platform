import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import LoginApplication from "./LoginApplication";
import { loginLocation, type LoginRuntime } from "./login-runtime";
import { COMPLETION_KEY } from "../onboarding/onboarding-state";
import { StoryProjectsError, type StoryProject } from "../../lib/api/story-projects";
import type { RecoveryState } from "../../development/story-projects/recovery";

const project: StoryProject = {
  id: "11111111-1111-4111-8111-111111111111", title: "A synthetic memory", description: null,
  language: "sv", status: "draft", created_at: "2026-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z",
};

function runtime(state: RecoveryState = "none") {
  const value: LoginRuntime = {
    auth: {
      signIn: vi.fn(async () => {}), signOut: vi.fn(async () => {}), getAccessToken: vi.fn(async () => null),
      invalidateSession: vi.fn(), onSignedOut: vi.fn(() => () => {}), getRecoveryState: () => state,
      onRecoveryChange: listener => { listener(state); return () => {}; }, updatePassword: vi.fn(async () => {}),
    },
    loadProjects: vi.fn(async () => [project]),
  };
  return value;
}

beforeEach(() => { window.history.replaceState(null, "", "/"); });
function welcome() {
  if (screen.queryByRole("button", { name: "Skip" })) fireEvent.click(screen.getByRole("button", { name: "Skip" }));
}
async function signIn() {
  fireEvent.change(await screen.findByLabelText("Email"), { target: { value: "synthetic@example.invalid" } });
  fireEvent.change(screen.getByLabelText("Password"), { target: { value: "synthetic-not-a-real-password" } });
  await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Sign in" })); });
}

describe("shared Memy Welcome to reviewed development authentication", () => {
  it("keeps auth lazy during first visit and enables only Login at Welcome", () => {
    const createRuntime = vi.fn(() => runtime());
    render(<LoginApplication createRuntime={createRuntime} />);
    expect(screen.getByRole("heading", { name: "Every life has a story." })).toBeVisible();
    expect(createRuntime).not.toHaveBeenCalled();
    welcome();
    expect(screen.getByRole("button", { name: "Log in" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Create Account" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Continue as Guest" })).toBeDisabled();
    expect(createRuntime).not.toHaveBeenCalled();
  });

  it.each(["/", "/index.html", "/?utm_source=family&type=book", "/#our-story", "/login-review.html?campaign=family"])("ordinary URL preserves introduction: %s", url => {
    window.history.replaceState(null, "", url);
    const createRuntime = vi.fn(() => runtime());
    const before = window.location.href;
    render(<LoginApplication createRuntime={createRuntime} />);
    expect(screen.getByRole("heading", { name: "Every life has a story." })).toBeVisible();
    expect(createRuntime).not.toHaveBeenCalled();
    expect(window.location.href).toBe(before);
  });

  it("shows returning visitors Welcome, then signs in and displays the reused list", async () => {
    localStorage.setItem(COMPLETION_KEY, "complete");
    const value = runtime(); const createRuntime = vi.fn(() => value);
    render(<LoginApplication createRuntime={createRuntime} />);
    expect(screen.getByRole("heading", { name: "Welcome to Memy." })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Log in" }));
    await signIn();
    expect(await screen.findByText(project.title)).toBeVisible();
    expect(value.auth.signIn).toHaveBeenCalledWith("synthetic@example.invalid", "synthetic-not-a-real-password");
    expect(screen.getByText("Swedish (sv)")).toBeVisible();
    expect(screen.getByText("draft")).toBeVisible();
    expect(createRuntime).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem(COMPLETION_KEY)).toBe("complete");
  });

  it("can return to Welcome and open Login again without locking navigation or losing motion", async () => {
    render(<LoginApplication createRuntime={() => runtime()} />);
    fireEvent.click(screen.getByRole("switch", { name: "Animations" }));
    welcome(); fireEvent.click(screen.getByRole("button", { name: "Log in" }));
    fireEvent.click(await screen.findByRole("button", { name: "Back to Welcome" }));
    const heading = screen.getByRole("heading", { name: "Welcome to Memy." });
    expect(heading).toHaveFocus();
    expect(screen.getByRole("switch", { name: "Animations" })).toHaveAttribute("aria-checked", "false");
    fireEvent.click(screen.getByRole("button", { name: "Log in" }));
    expect(await screen.findByLabelText("Email")).toBeVisible();
  });

  it("preserves Swedish from Welcome through Login and back, with disabled unapproved destinations", async () => {
    render(<LoginApplication createRuntime={() => runtime()} />);
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "sv" } });
    fireEvent.click(screen.getByRole("button", { name: "Hoppa över" }));
    expect(screen.getByRole("button", { name: "Skapa konto" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Fortsätt som gäst" })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Logga in" }));
    expect(await screen.findByLabelText("E-post")).toBeVisible();
    expect(screen.getByRole("heading", { name: "Mina berättelseprojekt" })).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Tillbaka till Välkommen" }));
    expect(screen.getByRole("heading", { name: "Välkommen till Memy." })).toBeVisible();
  });

  it("changing the authentication language keeps the same in-memory SDK runtime", async () => {
    const createRuntime = vi.fn(() => runtime());
    render(<LoginApplication createRuntime={createRuntime} />); welcome();
    fireEvent.click(screen.getByRole("button", { name: "Log in" }));
    await screen.findByLabelText("Email");
    const select = screen.getByRole("combobox"); select.focus();
    fireEvent.change(select, { target: { value: "sv" } });
    expect(screen.getByLabelText("E-post")).toBeVisible();
    expect(select).toHaveFocus();
    expect(createRuntime).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Tillbaka till Välkommen" }));
    expect(screen.getByRole("combobox")).toHaveValue("sv");
  });

  it("reports configuration failure without exposing internal errors or creating legacy auth", async () => {
    const createRuntime = vi.fn(() => { throw new Error("synthetic-private-configuration-value"); });
    render(<LoginApplication createRuntime={createRuntime} />); welcome();
    fireEvent.click(screen.getByRole("button", { name: "Log in" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("development settings");
    expect(screen.getByRole("heading", { name: "Login needs development settings" })).toHaveFocus();
    expect(document.body.textContent).not.toContain("synthetic-private-configuration-value");
    fireEvent.click(screen.getByRole("button", { name: "Back to Memy" }));
    expect(screen.getByRole("heading", { name: "Welcome to Memy." })).toBeVisible();
  });

  it("handles an empty project list", async () => {
    const value = runtime(); vi.mocked(value.loadProjects).mockResolvedValue([]);
    render(<LoginApplication createRuntime={() => value} />); welcome();
    fireEvent.click(screen.getByRole("button", { name: "Log in" })); await signIn();
    expect(await screen.findByText("You have no story projects yet.")).toBeVisible();
  });

  it.each(["network", "authentication"] as const)("handles a %s API failure without private project content", async kind => {
    const value = runtime(); vi.mocked(value.loadProjects).mockRejectedValue(new StoryProjectsError(kind));
    render(<LoginApplication createRuntime={() => value} />); welcome();
    fireEvent.click(screen.getByRole("button", { name: "Log in" })); await signIn();
    await waitFor(() => expect(screen.getByRole("alert")).toBeVisible());
    expect(document.body.textContent).not.toContain(project.title);
    if (kind === "authentication") expect(screen.getByLabelText("Password")).toBeVisible();
  });

  it("clears projects immediately while a failing sign-out is still pending", async () => {
    const value = runtime(); let reject!: (reason: Error) => void;
    vi.mocked(value.auth.signOut).mockImplementation(() => new Promise((_resolve, fail) => { reject = fail; }));
    render(<LoginApplication createRuntime={() => value} />); welcome();
    fireEvent.click(screen.getByRole("button", { name: "Log in" })); await signIn();
    expect(await screen.findByText(project.title)).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
    expect(document.body.textContent).not.toContain(project.title);
    expect(value.auth.invalidateSession).toHaveBeenCalled();
    await act(async () => { reject(new Error("synthetic-private-token")); });
    expect(await screen.findByRole("alert")).toHaveTextContent("projects have been cleared");
    expect(screen.getByRole("button", { name: "Reload to sign in" })).toBeVisible();
    expect(document.body.textContent).not.toContain("synthetic-private-token");
  });
});

describe("recovery bypass is handled by development auth, never legacy routing", () => {
  it.each(["/?type=recovery", "/#access_token=synthetic-invalid&type=recovery", "/story-projects.html?code=synthetic-code", "/aterstall-losenord", "/auth/callback?code=synthetic-code"])("bypasses intro without storage access or project reads: %s", async url => {
    window.history.replaceState(null, "", url);
    const read = vi.spyOn(Storage.prototype, "getItem"); const write = vi.spyOn(Storage.prototype, "setItem");
    const value = runtime("checking"); const createRuntime = vi.fn(() => value);
    render(<LoginApplication createRuntime={createRuntime} />);
    expect(await screen.findByText("Checking your recovery link…")).toBeVisible();
    expect(screen.queryByRole("heading", { name: "Every life has a story." })).not.toBeInTheDocument();
    expect(screen.queryByLabelText("New Password")).not.toBeInTheDocument();
    expect(read).not.toHaveBeenCalled(); expect(write).not.toHaveBeenCalled();
    expect(value.loadProjects).not.toHaveBeenCalled();
    expect(document.body.textContent).not.toMatch(/synthetic-(invalid|code)/);
  });

  it("hands a late callback to a fresh development runtime once", async () => {
    const value = runtime("checking"); const createRuntime = vi.fn(() => value);
    render(<LoginApplication createRuntime={createRuntime} />);
    await act(async () => {
      window.history.replaceState(null, "", "/#type=recovery");
      window.dispatchEvent(new HashChangeEvent("hashchange"));
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    expect(await screen.findByText("Checking your recovery link…")).toBeVisible();
    expect(createRuntime).toHaveBeenCalledTimes(1);
    expect(value.loadProjects).not.toHaveBeenCalled();
  });

  it("never activates a legacy deep link", () => {
    window.history.replaceState(null, "", "/test-spela-in");
    const createRuntime = vi.fn(() => runtime());
    render(<LoginApplication createRuntime={createRuntime} />);
    expect(screen.getByText(/outside the development login preview/)).toBeVisible();
    expect(createRuntime).not.toHaveBeenCalled();
  });

  it("distinguishes ordinary queries from auth markers", () => {
    expect(loginLocation({ pathname: "/", search: "?utm_source=family&type=book", hash: "#about" })).toBe("entrance");
    expect(loginLocation({ pathname: "/", search: "?code=synthetic-code", hash: "" })).toBe("auth");
  });
});
