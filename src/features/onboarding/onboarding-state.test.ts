import { describe, expect, it, vi } from "vitest";
import {
  COMPLETION_KEY,
  completeIntroduction,
  hasCompletedIntroduction,
  isAuthenticationCallback,
} from "./onboarding-state";

const locationFor = (path: string) => {
  const url = new URL(path, "http://127.0.0.1:5174");
  return { pathname: url.pathname, search: url.search, hash: url.hash };
};

describe("isolated onboarding completion", () => {
  it("treats a first visit as incomplete", () => {
    expect(hasCompletedIntroduction()).toBe(false);
  });

  it("recognizes only the versioned completion value", () => {
    window.localStorage.setItem(COMPLETION_KEY, "complete");
    expect(hasCompletedIntroduction()).toBe(true);
  });

  it.each(["", "true", "false", "1", "completed", "null", "<script>"])(
    "does not accept an arbitrary stored value: %s", (value) => {
      window.localStorage.setItem(COMPLETION_KEY, value);
      expect(hasCompletedIntroduction()).toBe(false);
    },
  );

  it("writes only its own completion flag", () => {
    window.localStorage.setItem("unrelated-setting", "preserved");
    expect(completeIntroduction()).toBe(true);
    expect(window.localStorage.getItem(COMPLETION_KEY)).toBe("complete");
    expect(window.localStorage.getItem("unrelated-setting")).toBe("preserved");
    expect(window.localStorage.length).toBe(2);
  });

  it("keeps working if storage reads are unavailable", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("blocked"); });
    expect(hasCompletedIntroduction()).toBe(false);
  });

  it("reports a denied completion write without throwing", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("quota"); });
    expect(completeIntroduction()).toBe(false);
  });

  it("handles browsers that deny the storage object itself", () => {
    vi.spyOn(window, "localStorage", "get").mockImplementation(() => { throw new Error("storage denied"); });
    expect(hasCompletedIntroduction()).toBe(false);
    expect(completeIntroduction()).toBe(false);
  });
});

describe("conservative authentication callback exemption", () => {
  it("allows only the dedicated preview with no query or fragment", () => {
    expect(isAuthenticationCallback(locationFor("/onboarding-review.html"))).toBe(false);
  });

  it.each([
    "/auth",
    "/auth/callback",
    "/login",
    "/signup",
    "/reset-password",
    "/password-recovery",
    "/recovery",
    "/callback",
    "/confirm",
    "/story-projects.html",
    "/onboarding-review.html?language=sv",
    "/onboarding-review.html#chapter-three",
    "/onboarding-review.html?code=synthetic-code",
    "/onboarding-review.html#access_token=synthetic-access",
    "/onboarding-review.html?refresh_token=synthetic-refresh",
    "/onboarding-review.html?token=synthetic-token",
    "/onboarding-review.html?token_hash=synthetic-hash",
    "/onboarding-review.html?type=recovery",
    "/onboarding-review.html#type=signup",
    "/onboarding-review.html?type=invite",
    "/onboarding-review.html?type=magiclink",
    "/onboarding-review.html?type=email_change",
    "/onboarding-review.html?error=expired",
    "/onboarding-review.html#error_description=synthetic-message",
    "/onboarding-review.html?error_code=otp_expired",
  ])("exempts authentication URLs without processing them: %s", (path) => {
    const location = locationFor(path);
    const before = { ...location };
    expect(isAuthenticationCallback(location)).toBe(true);
    expect(location).toEqual(before);
  });

  it("never reads storage while classifying a callback", () => {
    const read = vi.spyOn(Storage.prototype, "getItem");
    expect(isAuthenticationCallback(locationFor("/onboarding-review.html?type=recovery"))).toBe(true);
    expect(read).not.toHaveBeenCalled();
  });
});
