import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("next/navigation", () => ({
  useParams: () => ({ slug: "no-such-prompt" }),
}));

vi.mock("@/lib/i18n/provider", () => {
  const translations: Record<string, string> = {
    "recipes.notFound": "That prompt does not exist.",
    "recipes.backToPrompts": "Back to prompts",
  };
  return {
    useI18n: () => ({
      t: (key: string) => translations[key] ?? key,
      locale: "en",
      setLocale: vi.fn(),
    }),
  };
});

import PromptDetailPage from "../page";

describe("prompt detail route", () => {
  it("shows a not-found line with a link back to the prompts list", () => {
    render(<PromptDetailPage />);
    expect(screen.getByText("That prompt does not exist.")).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /Back to prompts/ }),
    ).toHaveAttribute("href", "/recipes");
  });
});
