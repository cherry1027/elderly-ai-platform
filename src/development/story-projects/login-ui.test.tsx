import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import MyStoryProjects from "./MyStoryProjects";
import PasswordRecovery from "./PasswordRecovery";
import type { DevelopmentAuth } from "./development";
import { PasswordRecoveryError, type RecoveryState } from "./recovery";
import type { StoryProject } from "@/lib/api/story-projects";

const project: StoryProject = {
  id: "11111111-1111-4111-8111-111111111111", title: "Syntetiska minnen", description: null,
  language: "sv", status: "draft", created_at: "2026-10-17T10:00:00Z", updated_at: "2026-10-17T10:00:00Z",
};
let auth: DevelopmentAuth;
let recovery: RecoveryState;
let recoveryListener: (state: RecoveryState) => void;
let signedOut: () => void;

beforeEach(() => {
  recovery = "none";
  auth = {
    signIn: vi.fn().mockResolvedValue(undefined), signOut: vi.fn().mockResolvedValue(undefined),
    invalidateSession: vi.fn(), getAccessToken: vi.fn().mockResolvedValue("synthetic-token"),
    onSignedOut: listener => { signedOut = listener; return vi.fn(); },
    getRecoveryState: () => recovery,
    onRecoveryChange: listener => { recoveryListener = listener; listener(recovery); return vi.fn(); },
    updatePassword: vi.fn().mockResolvedValue(undefined),
  };
});
function signIn(swedish = false) {
  fireEvent.change(screen.getByLabelText(swedish ? "E-post" : "Email"), { target: { value: "synthetic@example.invalid" } });
  fireEvent.change(screen.getByLabelText(swedish ? "Lösenord" : "Password"), { target: { value: "Synthetic-Only-Password!" } });
  fireEvent.submit(screen.getByRole("form", { name: swedish ? "Logga in i utvecklingsmiljön" : "Sign in to development" }));
}

describe("reused login UI in the integrated entrance (mock services only)", () => {
  it("provides Swedish signin, readonly list labels and safe Back action", async () => {
    const back = vi.fn(); const load = vi.fn().mockResolvedValue([project]);
    render(<MyStoryProjects auth={auth} loadProjects={load} language="sv" onBack={back} recoveryReturnPath="/" />);
    expect(screen.getByRole("main")).toHaveAttribute("lang", "sv");
    expect(screen.getByRole("button", { name: "Tillbaka till Välkommen" })).toBeVisible();
    expect(load).not.toHaveBeenCalled(); signIn(true);
    expect(await screen.findByRole("heading", { name: project.title })).toBeVisible();
    expect(screen.getByText("Svenska (sv)")).toBeVisible();
    expect(screen.getByRole("region", { name: "Dina berättelseprojekt" })).toBeVisible();
    expect(screen.queryByRole("button", { name: "Tillbaka till Välkommen" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /skapa|redigera|radera/i })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Logga ut" }));
    await screen.findByLabelText("Lösenord");
    fireEvent.click(screen.getByRole("button", { name: "Tillbaka till Välkommen" }));
    expect(back).toHaveBeenCalledTimes(1); expect(auth.invalidateSession).toHaveBeenCalled();
  });

  it("clears visible private rows immediately even while signout is pending", async () => {
    let resolve!: () => void;
    vi.mocked(auth.signOut).mockReturnValue(new Promise<void>(done => { resolve = done; }));
    render(<MyStoryProjects auth={auth} loadProjects={vi.fn().mockResolvedValue([project])} onBack={vi.fn()} />);
    signIn(); await screen.findByRole("heading", { name: project.title });
    fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
    expect(screen.queryByText(project.title)).not.toBeInTheDocument();
    expect(screen.getByLabelText("Email")).toHaveValue(""); expect(screen.getByLabelText("Password")).toHaveValue("");
    expect(auth.invalidateSession).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Signing out…" })).toBeDisabled();
    await act(async () => resolve());
    expect(screen.getByRole("button", { name: "Sign in" })).toBeEnabled();
  });

  it("keeps failed signout cleared and provides reload and Back escape without raw errors", async () => {
    vi.mocked(auth.signOut).mockRejectedValue(new Error("synthetic-private-token Synthetic-Only-Password!"));
    const back = vi.fn();
    render(<MyStoryProjects auth={auth} loadProjects={vi.fn().mockResolvedValue([project])} onBack={back} />);
    signIn(); await screen.findByRole("heading", { name: project.title });
    fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Your projects have been cleared");
    expect(screen.queryByText(project.title)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reload to sign in" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Back to Welcome" })).toBeEnabled();
    expect(screen.getByLabelText("Email")).toHaveFocus();
    expect(document.body).not.toHaveTextContent("synthetic-private-token");
    expect(document.body).not.toHaveTextContent("Synthetic-Only-Password!");
  });

  it("keeps signin locked when both invalidation and pending SDK logout emit signed-out", async () => {
    let resolve!: () => void;
    vi.mocked(auth.invalidateSession!).mockImplementation(() => signedOut());
    vi.mocked(auth.signOut).mockImplementation(() => {
      signedOut();
      return new Promise<void>(done => { resolve = done; });
    });
    render(<MyStoryProjects auth={auth} loadProjects={vi.fn().mockResolvedValue([project])} onBack={vi.fn()} />);
    signIn(); await screen.findByRole("heading", { name: project.title });
    fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
    expect(screen.queryByText(project.title)).not.toBeInTheDocument();
    expect(screen.getByLabelText("Email")).toBeDisabled();
    expect(screen.getByLabelText("Password")).toBeDisabled();
    expect(screen.getByRole("button", { name: "Signing out…" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Back to Welcome" })).toBeDisabled();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    await act(async () => resolve());
    expect(screen.getByRole("button", { name: "Sign in" })).toBeEnabled();
    expect(screen.getByLabelText("Email")).toHaveFocus();
  });

  it("aborts a pending read before signout settles and ignores its late rows", async () => {
    let resolveRead!: (rows: StoryProject[]) => void;
    let rejectLogout!: (error: Error) => void;
    const load = vi.fn((_signal: AbortSignal) => new Promise<StoryProject[]>(done => { resolveRead = done; }));
    vi.mocked(auth.signOut).mockReturnValue(new Promise<void>((_done, fail) => { rejectLogout = fail; }));
    render(<MyStoryProjects auth={auth} loadProjects={load} />); signIn();
    await screen.findByText("Loading your story projects…");
    fireEvent.click(screen.getByRole("button", { name: "Sign out" }));
    expect(load.mock.calls[0][0].aborted).toBe(true);
    await act(async () => resolveRead([project]));
    expect(screen.queryByText(project.title)).not.toBeInTheDocument();
    await act(async () => rejectLogout(new Error("synthetic-private-token")));
    expect(screen.queryByText(project.title)).not.toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("Could not confirm sign-out");
  });

  it("does not resurrect an old user's pending response after a fresh signin", async () => {
    let resolveOld!: (rows: StoryProject[]) => void;
    const load = vi.fn().mockImplementationOnce(() => new Promise<StoryProject[]>(done => { resolveOld = done; }))
      .mockResolvedValueOnce([]);
    render(<MyStoryProjects auth={auth} loadProjects={load} />); signIn();
    await screen.findByText("Loading your story projects…");
    act(() => signedOut()); signIn();
    await screen.findByText("You have no story projects yet.");
    await act(async () => resolveOld([project]));
    expect(screen.queryByText(project.title)).not.toBeInTheDocument(); expect(load).toHaveBeenCalledTimes(2);
  });

  it("offers a reload escape when SDK invalidation cancels a token read", async () => {
    const load = vi.fn((_signal: AbortSignal) => new Promise<StoryProject[]>(() => {}));
    render(<MyStoryProjects auth={auth} loadProjects={load} onBack={vi.fn()} />); signIn();
    await screen.findByText("Loading your story projects…");
    act(() => signedOut());
    expect(load.mock.calls[0][0].aborted).toBe(true);
    expect(screen.getByRole("alert")).toHaveTextContent("Please sign in again");
    expect(screen.getByRole("button", { name: "Reload to sign in" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Back to Welcome" })).toBeEnabled();
  });

  it("provides an enabled reload escape and clears password after bounded auth failure", async () => {
    vi.mocked(auth.signIn).mockRejectedValue(new Error("timeout synthetic-private-token"));
    const load = vi.fn(); render(<MyStoryProjects auth={auth} loadProjects={load} onBack={vi.fn()} />); signIn();
    expect(await screen.findByRole("alert")).toHaveTextContent("reload this preview");
    expect(screen.getByRole("button", { name: "Reload to sign in" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Back to Welcome" })).toBeEnabled();
    expect(screen.getByRole("form", { name: "Sign in to development" })).toHaveAttribute("aria-busy", "false");
    expect(screen.getByLabelText("Password")).toHaveValue("");
    expect(document.body).not.toHaveTextContent("synthetic-private-token"); expect(load).not.toHaveBeenCalled();
  });

  it("retains input focus when only the language changes", () => {
    const load = vi.fn(); const view = render(<MyStoryProjects auth={auth} loadProjects={load} />);
    screen.getByLabelText("Email").focus();
    view.rerender(<MyStoryProjects auth={auth} loadProjects={load} language="sv" />);
    expect(screen.getByLabelText("E-post")).toHaveFocus(); expect(load).not.toHaveBeenCalled();
  });

  it("clears pending signin passwords and never loads projects when recovery takes over", async () => {
    let resolve!: () => void;
    vi.mocked(auth.signIn).mockReturnValue(new Promise<void>(done => { resolve = done; }));
    const load = vi.fn(); render(<MyStoryProjects auth={auth} loadProjects={load} onBack={vi.fn()} />); signIn();
    act(() => { recovery = "ready"; recoveryListener("ready"); });
    expect(screen.getByLabelText("New Password")).toHaveValue("");
    expect(screen.queryByRole("button", { name: "Back to Welcome" })).not.toBeInTheDocument();
    await act(async () => resolve()); expect(load).not.toHaveBeenCalled();
  });

  it("ignores signin completion after the component unmounts", async () => {
    let resolve!: () => void;
    vi.mocked(auth.signIn).mockReturnValue(new Promise<void>(done => { resolve = done; }));
    const load = vi.fn(); const view = render(<MyStoryProjects auth={auth} loadProjects={load} />); signIn(); view.unmount();
    await act(async () => resolve()); expect(load).not.toHaveBeenCalled();
  });
});

describe("localized reused password recovery", () => {
  function submit() {
    fireEvent.change(screen.getByLabelText("Nytt lösenord"), { target: { value: "Synthetic-Only-Password!" } });
    fireEvent.change(screen.getByLabelText("Bekräfta lösenord"), { target: { value: "Synthetic-Only-Password!" } });
    fireEvent.submit(screen.getByRole("form", { name: "Välj ett nytt lösenord" }));
  }
  it("localizes the verified recovery form without a projects request", () => {
    recovery = "ready"; const load = vi.fn();
    render(<MyStoryProjects auth={auth} loadProjects={load} language="sv" onBack={vi.fn()} recoveryReturnPath="/" />);
    expect(screen.getByLabelText("Nytt lösenord")).toHaveFocus();
    expect(screen.getByLabelText("Bekräfta lösenord")).toHaveAttribute("autocomplete", "new-password");
    expect(screen.queryByRole("button", { name: "Tillbaka till Välkommen" })).not.toBeInTheDocument();
    expect(load).not.toHaveBeenCalled();
  });
  it.each(["checking", "invalid", "finishing", "cleanup-failed"] as const)("never shows password fields in %s", state => {
    recovery = state; const load = vi.fn(); render(<MyStoryProjects auth={auth} loadProjects={load} language="sv" />);
    expect(screen.queryByLabelText("Nytt lösenord")).not.toBeInTheDocument(); expect(load).not.toHaveBeenCalled();
  });
  it("announces and focuses a localized mismatch before any update", async () => {
    render(<PasswordRecovery auth={auth} state="ready" language="sv" />);
    fireEvent.change(screen.getByLabelText("Nytt lösenord"), { target: { value: "Synthetic-Only-Password!" } });
    fireEvent.change(screen.getByLabelText("Bekräfta lösenord"), { target: { value: "different" } });
    fireEvent.submit(screen.getByRole("form", { name: "Välj ett nytt lösenord" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Lösenorden matchar inte");
    expect(screen.getByRole("alert")).toHaveFocus(); expect(auth.updatePassword).not.toHaveBeenCalled();
  });
  it("uses a typed safe localized password-policy error", async () => {
    vi.mocked(auth.updatePassword).mockRejectedValue(new PasswordRecoveryError("weak"));
    render(<PasswordRecovery auth={auth} state="ready" language="sv" />); submit();
    expect(await screen.findByRole("alert")).toHaveTextContent("utvecklingsprojektets lösenordsregler");
    expect(screen.getByLabelText("Nytt lösenord")).toHaveValue(""); expect(screen.getByLabelText("Bekräfta lösenord")).toHaveValue("");
  });
  it("never echoes a raw SDK error, password or token", async () => {
    vi.mocked(auth.updatePassword).mockRejectedValue(new Error("Synthetic-Only-Password! synthetic-private-token"));
    render(<PasswordRecovery auth={auth} state="ready" language="sv" />); submit();
    expect(await screen.findByRole("alert")).toHaveTextContent("Lösenordet kunde inte uppdateras");
    expect(document.body).not.toHaveTextContent("Synthetic-Only-Password!"); expect(document.body).not.toHaveTextContent("synthetic-private-token");
  });
  it("restores ordinary localized signin only after confirmed recovery completion", async () => {
    recovery = "ready";
    vi.mocked(auth.updatePassword).mockImplementation(async () => { recovery = "complete"; recoveryListener("complete"); });
    const load = vi.fn(); render(<MyStoryProjects auth={auth} loadProjects={load} language="sv" onBack={vi.fn()} />); submit();
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Ditt lösenord har uppdaterats"));
    expect(screen.getByLabelText("Lösenord")).toHaveValue("");
    expect(screen.getByRole("button", { name: "Tillbaka till Välkommen" })).toBeEnabled(); expect(load).not.toHaveBeenCalled();
  });
});
