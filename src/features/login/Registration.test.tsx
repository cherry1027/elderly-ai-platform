import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import Registration from "./Registration";
import { RegistrationError, type ConfirmationState, type RegistrationAuth } from "./registration-auth";

function fixture(initial: ConfirmationState = "none") {
  let state = initial;
  const listeners = new Set<(state: ConfirmationState) => void>();
  const auth: RegistrationAuth = {
    signUp: vi.fn(async () => {}),
    getConfirmationState: () => state,
    onConfirmationChange: listener => { listeners.add(listener); return () => { listeners.delete(listener); }; },
  };
  return {
    auth,
    onSignIn: vi.fn(),
    onBack: vi.fn(),
    change(next: ConfirmationState) { state = next; listeners.forEach(listener => listener(next)); },
    listenerCount: () => listeners.size,
  };
}

function fill(email = "synthetic@example.invalid", password = " Synthetic password ! ", confirmation = password) {
  fireEvent.change(screen.getByLabelText("Email"), { target: { value: email } });
  fireEvent.change(screen.getByLabelText("Password"), { target: { value: password } });
  fireEvent.change(screen.getByLabelText("Confirm Password"), { target: { value: confirmation } });
}

const form = () => screen.getByRole("form", { name: "Create your Memy account" });

describe("development registration form with mocked authentication only", () => {
  it("provides a focused heading, accessible fields, autocomplete and backend-policy guidance", () => {
    const value = fixture(); render(<Registration {...value} language="en" />);
    expect(screen.getByRole("heading", { name: "Create your Memy account" })).toHaveFocus();
    expect(screen.getByLabelText("Email")).toHaveAttribute("type", "email");
    expect(screen.getByLabelText("Email")).toHaveAttribute("autoComplete", "email");
    for (const name of ["Password", "Confirm Password"]) {
      expect(screen.getByLabelText(name)).toHaveAttribute("type", "password");
      expect(screen.getByLabelText(name)).toHaveAttribute("autoComplete", "new-password");
      expect(screen.getByLabelText(name)).not.toHaveAttribute("minLength");
    }
    expect(screen.getByText(/Supabase checks those rules/)).toBeVisible();
    expect(value.auth.signUp).not.toHaveBeenCalled();
  });

  it("rejects missing fields without authentication calls and focuses the accessible error", () => {
    const value = fixture(); render(<Registration {...value} language="en" />);
    fireEvent.submit(form());
    expect(screen.getByRole("alert")).toHaveTextContent("Enter your email and password");
    expect(screen.getByRole("alert")).toHaveFocus();
    expect(value.auth.signUp).not.toHaveBeenCalled();
  });

  it("rejects malformed email without authentication calls", () => {
    const value = fixture(); render(<Registration {...value} language="en" />);
    fill("invalid-email"); fireEvent.submit(form());
    expect(screen.getByRole("alert")).toHaveTextContent("valid email address");
    expect(screen.getByLabelText("Email")).toHaveAttribute("aria-invalid", "true");
    expect(value.auth.signUp).not.toHaveBeenCalled();
  });

  it("rejects mismatching passwords without authentication calls", () => {
    const value = fixture(); render(<Registration {...value} language="en" />);
    fill(undefined, "Synthetic-one!", "Synthetic-two!"); fireEvent.submit(form());
    expect(screen.getByRole("alert")).toHaveTextContent("passwords do not match");
    expect(screen.getByLabelText("Confirm Password")).toHaveAttribute("aria-invalid", "true");
    expect(value.auth.signUp).not.toHaveBeenCalled();
  });

  it("trims email only, clears credentials and gives a generic confirmation result", async () => {
    const value = fixture(); render(<Registration {...value} language="en" />);
    fill(" synthetic@example.invalid "); fireEvent.submit(form());
    expect(await screen.findByRole("status")).toHaveTextContent("If registration can proceed");
    expect(value.auth.signUp).toHaveBeenCalledWith("synthetic@example.invalid", " Synthetic password ! ");
    expect(screen.queryByLabelText("Email")).not.toBeInTheDocument();
    expect(document.body).not.toHaveTextContent("synthetic@example.invalid");
    expect(document.body).not.toHaveTextContent("Synthetic password");
    expect(screen.getByRole("heading")).toHaveFocus();
    fireEvent.click(screen.getByRole("button", { name: "Go to sign in" }));
    expect(value.onSignIn).toHaveBeenCalledTimes(1);
  });

  it("blocks duplicate synchronous submissions before React rerenders", async () => {
    const value = fixture(); let finish!: () => void;
    vi.mocked(value.auth.signUp).mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    render(<Registration {...value} language="en" />); fill();
    const element = form();
    act(() => { fireEvent.submit(element); fireEvent.submit(element); });
    expect(value.auth.signUp).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Creating account…" })).toBeDisabled();
    expect(screen.getByLabelText("Password")).toBeDisabled();
    await act(async () => { finish(); });
    expect(screen.getByRole("status")).toHaveTextContent("If registration can proceed");
  });

  it.each([
    ["weak", "password rules"], ["rate-limit", "Too many requests"], ["failed", "could not be completed"],
    ["configuration", "development authentication settings"], ["invalid-email", "valid email address"],
  ] as const)("maps %s errors to static text and clears password fields", async (kind, message) => {
    const value = fixture(); vi.mocked(value.auth.signUp).mockRejectedValue(new RegistrationError(kind));
    render(<Registration {...value} language="en" />); fill(); fireEvent.submit(form());
    expect(await screen.findByRole("alert")).toHaveTextContent(message);
    expect(screen.getByRole("alert")).toHaveFocus();
    expect(screen.getByLabelText("Password")).toHaveValue("");
    expect(screen.getByLabelText("Confirm Password")).toHaveValue("");
    expect(screen.getByLabelText("Email")).toHaveValue("synthetic@example.invalid");
  });

  it("never renders unexpected server messages containing credentials", async () => {
    const value = fixture(); vi.mocked(value.auth.signUp).mockRejectedValue(new Error("synthetic-private-token synthetic@example.invalid Synthetic password !"));
    render(<Registration {...value} language="en" />); fill(); fireEvent.submit(form());
    expect(await screen.findByRole("alert")).toHaveTextContent("Registration could not be completed");
    expect(document.body).not.toHaveTextContent("synthetic-private-token");
    expect(document.body).not.toHaveTextContent("Synthetic password");
  });

  it("provides Swedish fields, validation, actions and confirmation text", async () => {
    const value = fixture(); render(<Registration {...value} language="sv" />);
    expect(screen.getByRole("heading", { name: "Skapa ditt Memy-konto" })).toHaveFocus();
    fireEvent.change(screen.getByLabelText("E-post"), { target: { value: "synthetic@example.invalid" } });
    fireEvent.change(screen.getByLabelText("Lösenord"), { target: { value: "Synthetic password!" } });
    fireEvent.change(screen.getByLabelText("Bekräfta lösenord"), { target: { value: "different" } });
    fireEvent.submit(screen.getByRole("form", { name: "Skapa ditt Memy-konto" }));
    expect(screen.getByRole("alert")).toHaveTextContent("Lösenorden matchar inte");
    fireEvent.change(screen.getByLabelText("Bekräfta lösenord"), { target: { value: "Synthetic password!" } });
    fireEvent.submit(screen.getByRole("form", { name: "Skapa ditt Memy-konto" }));
    expect(await screen.findByRole("status")).toHaveTextContent("Om registreringen kan fortsätta");
    expect(screen.getByRole("button", { name: "Gå till inloggning" })).toBeVisible();
  });

  it("does not refocus the heading when the language changes", () => {
    const value = fixture(); const view = render(<Registration {...value} language="en" />);
    screen.getByLabelText("Email").focus();
    view.rerender(<Registration {...value} language="sv" />);
    expect(screen.getByLabelText("E-post")).toHaveFocus();
  });

  it("allows returning to Welcome without authentication requests", () => {
    const value = fixture(); render(<Registration {...value} language="en" />);
    fireEvent.click(screen.getByRole("button", { name: "Back to Welcome" }));
    expect(value.onBack).toHaveBeenCalledTimes(1);
    expect(value.auth.signUp).not.toHaveBeenCalled();
  });
});

describe("registration confirmation state rendering", () => {
  it("shows checking without exposing a form or starting signup", () => {
    const value = fixture("checking"); render(<Registration {...value} language="en" />);
    expect(screen.getByRole("status")).toHaveTextContent("Checking your confirmation link");
    expect(screen.queryByRole("form")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Go to sign in" })).not.toBeInTheDocument();
    expect(value.auth.signUp).not.toHaveBeenCalled();
  });

  it("shows confirmed success only after the adapter supplies complete", () => {
    const value = fixture("checking"); render(<Registration {...value} language="en" />);
    act(() => { value.change("complete"); });
    expect(screen.getByRole("status")).toHaveTextContent("email confirmation was verified");
    expect(screen.getByRole("heading")).toHaveFocus();
    expect(screen.queryByRole("form")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Go to sign in" }));
    expect(value.onSignIn).toHaveBeenCalledTimes(1);
    expect(value.auth.signUp).not.toHaveBeenCalled();
  });

  it("invalid links show safe guidance and sign-in without a registration form", () => {
    const value = fixture("invalid"); render(<Registration {...value} language="en" />);
    expect(screen.getByRole("alert")).toHaveTextContent("invalid, expired, already used");
    expect(screen.queryByRole("form")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Go to sign in" }));
    expect(value.onSignIn).toHaveBeenCalledTimes(1);
    expect(value.auth.signUp).not.toHaveBeenCalled();
  });

  it("cleanup failure offers only reload and cannot enter sign-in or registration", () => {
    const value = fixture("cleanup-failed"); render(<Registration {...value} language="en" />);
    expect(screen.getByRole("alert")).toHaveTextContent("could not be closed safely");
    expect(screen.getAllByRole("button")).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Reload to sign in" })).toBeVisible();
    expect(screen.queryByRole("form")).not.toBeInTheDocument();
    expect(value.onSignIn).not.toHaveBeenCalled();
  });

  it("a signup cleanup error also removes the form and sign-in actions", async () => {
    const value = fixture(); vi.mocked(value.auth.signUp).mockRejectedValue(new RegistrationError("cleanup"));
    render(<Registration {...value} language="en" />); fill(); fireEvent.submit(form());
    expect(await screen.findByRole("alert")).toHaveTextContent("could not be closed safely");
    expect(screen.getAllByRole("button")).toHaveLength(1);
    expect(screen.queryByRole("form")).not.toBeInTheDocument();
  });

  it("a signup timeout offers check-email guidance and reload without retry or sign-in", async () => {
    const value = fixture(); vi.mocked(value.auth.signUp).mockRejectedValue(new RegistrationError("timeout"));
    render(<Registration {...value} language="en" />); fill(); fireEvent.submit(form());
    expect(await screen.findByRole("alert")).toHaveTextContent("took too long");
    expect(screen.getByRole("alert")).toHaveTextContent("Check your email");
    expect(screen.getByRole("alert")).toHaveFocus();
    expect(screen.getAllByRole("button")).toHaveLength(1);
    expect(screen.getByRole("button", { name: "Reload to sign in" })).toBeVisible();
    expect(screen.queryByRole("form")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Go to sign in" })).not.toBeInTheDocument();
    expect(value.auth.signUp).toHaveBeenCalledTimes(1);
  });

  it("a late confirmation state removes credentials and unsubscribes on unmount", () => {
    const value = fixture(); const view = render(<Registration {...value} language="en" />); fill();
    expect(value.listenerCount()).toBe(1);
    act(() => { value.change("checking"); });
    expect(screen.queryByLabelText("Password")).not.toBeInTheDocument();
    expect(document.body).not.toHaveTextContent("Synthetic password");
    view.unmount(); expect(value.listenerCount()).toBe(0);
    expect(value.auth.signUp).not.toHaveBeenCalled();
  });

  it("settling a submission after unmount performs no navigation", async () => {
    const value = fixture(); let finish!: () => void;
    vi.mocked(value.auth.signUp).mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const view = render(<Registration {...value} language="en" />); fill(); fireEvent.submit(form());
    view.unmount(); await act(async () => { finish(); });
    expect(value.onSignIn).not.toHaveBeenCalled(); expect(value.onBack).not.toHaveBeenCalled();
    await waitFor(() => expect(value.listenerCount()).toBe(0));
  });

  it("a late signup result cannot replace a newer invalid confirmation state", async () => {
    const value = fixture(); let finish!: () => void;
    vi.mocked(value.auth.signUp).mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    render(<Registration {...value} language="en" />); fill(); fireEvent.submit(form());
    act(() => { value.change("invalid"); });
    await act(async () => { finish(); });
    expect(screen.getByRole("alert")).toHaveTextContent("invalid, expired, already used");
    expect(screen.queryByText(/If registration can proceed/)).not.toBeInTheDocument();
    expect(value.onSignIn).not.toHaveBeenCalled();
  });
});
