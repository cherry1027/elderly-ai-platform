import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { OnboardingExperience } from "./OnboardingExperience";
import { COMPLETION_KEY } from "./onboarding-state";

const firstTitle = "Every life has a story.";
const secondTitle = "Speak at your own pace.";
const thirdTitle = "Your memories. Your autobiography.";
const welcomeTitle = "Welcome to Memy.";
const heading = (title: string) => screen.getByRole("heading", { level: 1, name: title });
const next = () => fireEvent.click(screen.getByRole("button", { name: /^Next$/i }));

describe("Beautiful Memory Book introduction", () => {
  it("starts a first visit in English on the first scene", () => {
    render(<OnboardingExperience />);
    expect(heading(firstTitle)).toBeVisible();
    expect(screen.getByRole("combobox", { name: "Language" })).toHaveValue("en");
    expect(screen.getByRole("button", { name: /^Back$/i })).toBeDisabled();
    expect(screen.getByRole("button", { name: /^Next$/i })).toBeEnabled();
    expect(screen.getByRole("button", { name: /^Skip$/i })).toBeEnabled();
  });

  it("shows a polite progress announcement", () => {
    render(<OnboardingExperience />);
    const progress = screen.getByRole("status");
    expect(progress).toHaveAttribute("aria-live", "polite");
    expect(progress).toHaveTextContent(`1 of 3 · ${firstTitle}`);
    next();
    expect(progress).toHaveTextContent(`2 of 3 · ${secondTitle}`);
  });

  it("moves through three scenes and exposes a separate final entry action", () => {
    render(<OnboardingExperience />);
    next();
    expect(heading(secondTitle)).toBeVisible();
    next();
    expect(heading(thirdTitle)).toBeVisible();
    expect(screen.queryByRole("button", { name: /^Next$/i })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Enter Memy" })).toBeEnabled();
    expect(window.localStorage.getItem(COMPLETION_KEY)).toBeNull();
  });

  it("never advances a scene automatically", () => {
    vi.useFakeTimers();
    try {
      render(<OnboardingExperience />);
      act(() => { vi.advanceTimersByTime(180_000); });
      expect(heading(firstTitle)).toBeVisible();
      expect(window.localStorage.getItem(COMPLETION_KEY)).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("moves back without completing the introduction", () => {
    render(<OnboardingExperience />);
    next();
    next();
    fireEvent.click(screen.getByRole("button", { name: /^Back$/i }));
    expect(heading(secondTitle)).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: /^Back$/i }));
    expect(heading(firstTitle)).toBeVisible();
    expect(screen.getByRole("button", { name: /^Back$/i })).toBeDisabled();
    expect(window.localStorage.getItem(COMPLETION_KEY)).toBeNull();
  });

  it("moves focus to each newly selected scene heading", () => {
    render(<OnboardingExperience />);
    next();
    expect(heading(secondTitle)).toHaveFocus();
    fireEvent.click(screen.getByRole("button", { name: /^Back$/i }));
    expect(heading(firstTitle)).toHaveFocus();
  });

  it("does not complete on rapid multi-clicks of Next", () => {
    render(<OnboardingExperience />);
    const button = screen.getByRole("button", { name: /^Next$/i });
    fireEvent.click(button, { detail: 1 });
    fireEvent.click(button, { detail: 2 });
    fireEvent.click(button, { detail: 3 });
    expect(screen.queryByRole("heading", { name: welcomeTitle })).not.toBeInTheDocument();
    expect(window.localStorage.getItem(COMPLETION_KEY)).toBeNull();
  });

  it("does not let repeated clicks on the former Next control enter Memy", () => {
    render(<OnboardingExperience />);
    next();
    const secondNext = screen.getByRole("button", { name: /^Next$/i });
    fireEvent.click(secondNext);
    fireEvent.click(secondNext);
    expect(heading(thirdTitle)).toBeVisible();
    expect(window.localStorage.getItem(COMPLETION_KEY)).toBeNull();
  });

  it("completes after deliberate Enter Memy activation", () => {
    render(<OnboardingExperience />);
    next();
    next();
    const enter = screen.getByRole("button", { name: "Enter Memy" });
    enter.focus();
    expect(enter.tagName).toBe("BUTTON");
    expect(enter).toHaveFocus();
    fireEvent.click(enter);
    expect(heading(welcomeTitle)).toBeVisible();
    expect(heading(welcomeTitle)).toHaveFocus();
    expect(window.localStorage.getItem(COMPLETION_KEY)).toBe("complete");
  });

  it("Skip reaches only the isolated welcome screen and records completion", () => {
    window.localStorage.setItem("legacy-auth-setting", "untouched");
    render(<OnboardingExperience />);
    fireEvent.click(screen.getByRole("button", { name: /^Skip$/i }));
    expect(heading(welcomeTitle)).toBeVisible();
    expect(window.location.pathname).toBe("/onboarding-review.html");
    expect(window.localStorage.getItem(COMPLETION_KEY)).toBe("complete");
    expect(window.localStorage.getItem("legacy-auth-setting")).toBe("untouched");
  });

  it("returning visitors see welcome and can replay from the first scene", () => {
    window.localStorage.setItem(COMPLETION_KEY, "complete");
    render(<OnboardingExperience />);
    expect(heading(welcomeTitle)).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Replay Introduction" }));
    expect(heading(firstTitle)).toBeVisible();
    expect(heading(firstTitle)).toHaveFocus();
    expect(screen.getByRole("status")).toHaveTextContent("1 of 3");
  });

  it("a completed introduction remains complete across remounts", () => {
    const firstRender = render(<OnboardingExperience />);
    fireEvent.click(screen.getByRole("button", { name: /^Skip$/i }));
    firstRender.unmount();
    render(<OnboardingExperience />);
    expect(heading(welcomeTitle)).toBeVisible();
  });

  it("welcome account actions are explicitly unavailable in the preview", () => {
    window.localStorage.setItem(COMPLETION_KEY, "complete");
    render(<OnboardingExperience />);
    for (const name of ["Log in", "Create Account", "Continue as Guest"]) {
      expect(screen.getByRole("button", { name })).toBeDisabled();
    }
    expect(screen.getAllByText(/preview/i).length).toBeGreaterThan(0);
  });

  it("remains navigable when completion storage fails", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("blocked"); });
    render(<OnboardingExperience />);
    fireEvent.click(screen.getByRole("button", { name: /^Skip$/i }));
    expect(heading(welcomeTitle)).toBeVisible();
    expect(screen.getByRole("button", { name: "Replay Introduction" })).toBeEnabled();
  });

  it("remains usable when storage reads fail", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("blocked"); });
    render(<OnboardingExperience />);
    expect(heading(firstTitle)).toBeVisible();
    next();
    expect(heading(secondTitle)).toBeVisible();
  });

  it("uses named native controls that can receive keyboard focus", () => {
    render(<OnboardingExperience />);
    const controls = [
      screen.getByRole("combobox", { name: "Language" }),
      screen.getByRole("button", { name: /^Skip$/i }),
      screen.getByRole("button", { name: /^Next$/i }),
    ];
    for (const control of controls) {
      control.focus();
      expect(control).toHaveFocus();
    }
    // Browser keyboard activation is supplied by native <button>/<select> semantics.
    expect(controls[1].tagName).toBe("BUTTON");
    expect(controls[2].tagName).toBe("BUTTON");
  });
});

describe("English and Swedish presentation", () => {
  it("changes the current scene and controls to Swedish", () => {
    render(<OnboardingExperience />);
    const language = screen.getByRole("combobox", { name: "Language" });
    expect(within(language).getByRole("option", { name: "English" })).toHaveValue("en");
    expect(within(language).getByRole("option", { name: "Svenska" })).toHaveValue("sv");
    fireEvent.change(language, { target: { value: "sv" } });
    expect(screen.getByRole("heading", { level: 1 }).closest("[lang]")).toHaveAttribute("lang", "sv");
    expect(screen.queryByRole("heading", { name: firstTitle })).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1 })).toHaveFocus();
    expect(screen.getByRole("button", { name: "Nästa" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Tillbaka" })).toBeDisabled();
  });

  it("preserves scene position while switching languages", () => {
    render(<OnboardingExperience />);
    next();
    fireEvent.change(screen.getByRole("combobox", { name: "Language" }), { target: { value: "sv" } });
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "en" } });
    expect(heading(secondTitle)).toBeVisible();
    expect(screen.getByRole("status")).toHaveTextContent("2 of 3");
    expect(heading(secondTitle).closest("[lang]")).toHaveAttribute("lang", "en");
  });

  it("uses Swedish on all three scenes and the welcome destination", () => {
    render(<OnboardingExperience />);
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "sv" } });
    fireEvent.click(screen.getByRole("button", { name: "Nästa" }));
    expect(screen.queryByRole("heading", { name: secondTitle })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Nästa" }));
    expect(screen.queryByRole("heading", { name: thirdTitle })).not.toBeInTheDocument();
    const entry = screen.getAllByRole("button").find((button) => /Memy/.test(button.textContent ?? ""));
    expect(entry).toBeDefined();
    fireEvent.click(entry!);
    expect(screen.queryByRole("heading", { name: welcomeTitle })).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1 })).toBeVisible();
    expect(screen.getByRole("heading", { level: 1 }).closest("[lang]")).toHaveAttribute("lang", "sv");
  });
});

describe("motion preferences", () => {
  it("lets visitors pause and resume the decorative animations", () => {
    const { container } = render(<OnboardingExperience />);
    fireEvent.click(screen.getByRole("button", { name: "Turn animations off" }));
    expect(screen.getByRole("button", { name: "Turn animations on" })).toHaveAttribute("aria-pressed", "true");
    expect(container.querySelector('[data-motion="off"]')).toBeInTheDocument();
    next();
    expect(heading(secondTitle)).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Turn animations on" }));
    expect(screen.getByRole("button", { name: "Turn animations off" })).toHaveAttribute("aria-pressed", "false");
  });

  it("starts with animations disabled for reduced-motion users", () => {
    vi.spyOn(window, "matchMedia").mockImplementation((query) => ({
      matches: true, media: query, onchange: null,
      addListener: vi.fn(), removeListener: vi.fn(),
      addEventListener: vi.fn(), removeEventListener: vi.fn(), dispatchEvent: vi.fn(() => true),
    }));
    const { container } = render(<OnboardingExperience />);
    expect(container.querySelector('[data-motion="off"]')).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Turn animations on" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Turn animations on" })).toBeDisabled();
  });

  it("responds to a changed system preference while the preview is open", () => {
    let preferenceChanged: EventListenerOrEventListenerObject | undefined;
    let reduced = false;
    const remove = vi.fn();
    vi.spyOn(window, "matchMedia").mockImplementation((query) => ({
      get matches() { return reduced; }, media: query, onchange: null,
      addListener: vi.fn(), removeListener: vi.fn(),
      addEventListener: vi.fn((_type: string, listener: EventListenerOrEventListenerObject) => { preferenceChanged = listener; }),
      removeEventListener: remove, dispatchEvent: vi.fn(() => true),
    }));
    const { container, unmount } = render(<OnboardingExperience />);
    expect(preferenceChanged).toBeDefined();
    act(() => {
      reduced = true;
      const event = { matches: true } as MediaQueryListEvent;
      if (typeof preferenceChanged === "function") preferenceChanged(event);
      else preferenceChanged?.handleEvent(event);
    });
    expect(container.querySelector('[data-motion="off"]')).toBeInTheDocument();
    unmount();
    expect(remove).toHaveBeenCalled();
  });
});

describe("callback exemption is passive and does not consume authentication", () => {
  it("locks the introduction when a callback fragment arrives later", () => {
    render(<OnboardingExperience />);
    expect(heading(firstTitle)).toBeVisible();
    const write = vi.spyOn(Storage.prototype, "setItem");
    act(() => {
      window.history.replaceState(null, "", "/onboarding-review.html#type=recovery");
      window.dispatchEvent(new HashChangeEvent("hashchange"));
    });
    expect(heading("Continue your sign-in safely.")).toBeVisible();
    expect(screen.queryByRole("button", { name: /^Next$/i })).not.toBeInTheDocument();
    expect(write).not.toHaveBeenCalled();
  });

  it("locks the preview on a later authentication navigation", () => {
    render(<OnboardingExperience />);
    act(() => {
      window.history.replaceState(null, "", "/auth/callback?code=synthetic-code");
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    expect(heading("Continue your sign-in safely.")).toBeVisible();
    expect(window.location.search).toBe("?code=synthetic-code");
    expect(window.localStorage.getItem(COMPLETION_KEY)).toBeNull();
  });

  it.each([
    "/onboarding-review.html?code=synthetic-code",
    "/onboarding-review.html#access_token=synthetic-access&type=recovery",
    "/onboarding-review.html?error_code=otp_expired&error_description=synthetic-message",
    "/story-projects.html#type=recovery",
  ])("does not interrupt or reveal callback data: %s", (url) => {
    window.history.replaceState(null, "", url);
    const before = window.location.href;
    const read = vi.spyOn(Storage.prototype, "getItem");
    const write = vi.spyOn(Storage.prototype, "setItem");
    const { container } = render(<OnboardingExperience />);
    expect(heading("Continue your sign-in safely.")).toBeVisible();
    expect(screen.queryByRole("button", { name: /^Next$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Skip$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Replay Introduction" })).not.toBeInTheDocument();
    expect(container.textContent).not.toMatch(/synthetic-(code|access|message)/);
    expect(window.location.href).toBe(before);
    expect(read).not.toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();
  });
});
