import "@testing-library/jest-dom/vitest";
import { describe, it, expect, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

vi.mock("@/lib/i18n/provider", () => {
  const translations: Record<string, string> = {
    "recipes.title": "Get your prompts",
    "recipes.subtitle":
      "Copy-ready prompts for the Post Engineer MCP server. Copy one, paste it into your agent, done.",
    "recipes.dailyNewsTitle": "Daily news becomes a video",
    "recipes.dailyNewsObjective":
      "Turn one news story of the day into one persona video.",
    "recipes.githubPrsTitle": "GitHub PRs become videos",
    "recipes.githubPrsObjective":
      "Turn your GitHub pull requests into persona videos.",
    "recipes.kindRecipe": "Recipe",
    "recipes.kindPrompt": "Prompt",
    "recipes.openPrompt": "Open prompt",
    "recipes.filterAll": "All",
    "recipes.searchLabel": "Search prompts",
    "recipes.emptyState": "No prompt matches your search.",
  };
  return {
    useI18n: () => ({
      t: (key: string, vars?: Record<string, string | number>) =>
        vars === undefined
          ? (translations[key] ?? key)
          : `${key}:${JSON.stringify(vars)}`,
      locale: "en",
      setLocale: vi.fn(),
    }),
  };
});

import RecipesPage from "../page";

describe("/recipes prompts hub list", () => {
  it("renders the hub title and subtitle", () => {
    render(<RecipesPage />);
    expect(
      screen.getByRole("heading", { name: "Get your prompts" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "Copy-ready prompts for the Post Engineer MCP server. Copy one, paste it into your agent, done.",
      ),
    ).toBeInTheDocument();
  });

  it("links each entry to its own detail page, not straight to GitHub", () => {
    render(<RecipesPage />);
    expect(
      screen.getByRole("link", { name: /Daily news becomes a video/ }),
    ).toHaveAttribute("href", "/recipes/daily-news");
    expect(
      screen.getByRole("link", { name: /GitHub PRs become videos/ }),
    ).toHaveAttribute("href", "/recipes/github-prs");
    expect(
      screen.queryByText(
        /Turn this GitHub pull request into one persona video/,
      ),
    ).not.toBeInTheDocument();
  });

  it("labels entries by kind, not by sequence number", () => {
    render(<RecipesPage />);
    expect(screen.getAllByText("Recipe")).toHaveLength(2);
    expect(screen.getAllByText("Prompt")).toHaveLength(2);
    expect(screen.queryByText("01")).not.toBeInTheDocument();
    expect(screen.queryByText("02")).not.toBeInTheDocument();
  });

  it("narrows the grid by kind chip", () => {
    render(<RecipesPage />);
    fireEvent.click(screen.getByRole("button", { name: "Prompt" }));
    expect(screen.getByRole("button", { name: "Prompt" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(
      screen.queryByRole("link", { name: /Daily news becomes a video/ }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /GitHub PRs become videos/ }),
    ).toBeInTheDocument();
  });

  it("shows the empty state when search matches nothing", () => {
    render(<RecipesPage />);
    fireEvent.change(
      screen.getByRole("searchbox", { name: "Search prompts" }),
      {
        target: { value: "zzz-no-match" },
      },
    );
    expect(
      screen.getByText("No prompt matches your search."),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: /GitHub PRs/ }),
    ).not.toBeInTheDocument();
  });

  it("shows the step count on each card", () => {
    render(<RecipesPage />);
    expect(screen.getAllByText('recipes.stepCount:{"count":5}')).toHaveLength(
      2,
    );
  });
});
