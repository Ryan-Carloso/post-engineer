import { describe, it, expect } from "vitest";
import { PROMPTS, getPrompt } from "../prompts";

describe("prompts hub data", () => {
  it("has one data entry per prompt, and adding a prompt is adding one entry", () => {
    expect(PROMPTS.map((prompt) => prompt.slug)).toEqual([
      "daily-news",
      "github-prs",
    ]);
    for (const prompt of PROMPTS) {
      expect(prompt.titleKey).toMatch(/^recipes\./);
      expect(prompt.objectiveKey).toMatch(/^recipes\./);
      expect(prompt.kindKey).toMatch(/^recipes\./);
      expect(prompt.stepKeys).toHaveLength(5);
      expect(prompt.deliverKeys).toHaveLength(3);
      expect(prompt.exampleInputKey).toMatch(/^recipes\./);
      expect(prompt.exampleOutputKey).toMatch(/^recipes\./);
      expect(prompt.docHref).toContain("docs/recipes/");
      expect(prompt.prompt.length).toBeGreaterThan(200);
    }
  });

  it("resolves a prompt by slug and returns undefined for an unknown slug", () => {
    expect(getPrompt("daily-news")?.slug).toBe("daily-news");
    expect(getPrompt("github-prs")?.slug).toBe("github-prs");
    expect(getPrompt("no-such-prompt")).toBeUndefined();
  });

  it("bakes the segments contract into every prompt text", () => {
    for (const prompt of PROMPTS) {
      expect(prompt.prompt).toContain("validate_script");
      expect(prompt.prompt).toContain("generate_persona_video");
      expect(prompt.prompt).toContain("60–200 words");
      expect(prompt.prompt).toContain("hook");
      expect(prompt.prompt).toContain("CTA");
    }
  });
});
