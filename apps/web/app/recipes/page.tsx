"use client";

import { useState } from "react";
import { useI18n } from "@/lib/i18n/provider";
import { PROMPTS } from "./prompts";
import { filterPrompts, promptKinds, type KindFilter } from "./prompts-filter";
import PromptsHero from "./components/prompts-hero";
import PromptsToolbar, { type KindOption } from "./components/prompts-toolbar";
import PromptCard from "./components/prompt-card";
import PromptsEmpty from "./components/prompts-empty";

//---------------
// Prompts hub list — rendered inside the AppShell for signed-in
// users and the public frame otherwise (see layout.tsx). Hero, a search + kind filter toolbar, and a
// responsive card grid (1 column on phones, 2 on tablets, 3 on
// desktop) so the page keeps its shape as prompts are added. The
// full prompt lives on the detail page, not here, and the list
// never links straight to GitHub. Route stays /recipes; only the
// display name is "Get your prompts" (via i18n), so existing
// links and the public middleware path keep working. Solid colors
// only, from the existing palette: ink #101728, paper #f7f8fa,
// accent #ff544c. To add a prompt, add one entry to PROMPTS in
// prompts.ts.
//---------------

export default function RecipesPage() {
  const { t } = useI18n();
  const [query, setQuery] = useState("");
  const [kind, setKind] = useState<KindFilter>("all");

  const visible = filterPrompts(PROMPTS, kind, query, t);
  const kinds: KindOption<KindFilter>[] = [
    { value: "all", label: t("recipes.filterAll") },
    ...promptKinds(PROMPTS).map((key) => ({ value: key, label: t(key) })),
  ];

  return (
    <div className="mx-auto flex w-full max-w-375 flex-col gap-5 lg:gap-6">
      <PromptsHero
        title={t("recipes.title")}
        subtitle={t("recipes.subtitle")}
        countLabel={t("recipes.promptCount", { count: PROMPTS.length })}
      />
      <PromptsToolbar
        query={query}
        onQueryChange={setQuery}
        searchLabel={t("recipes.searchLabel")}
        searchPlaceholder={t("recipes.searchPlaceholder")}
        kinds={kinds}
        activeKind={kind}
        onKindChange={setKind}
      />
      <div>
        {visible.length === 0 ? (
          <PromptsEmpty message={t("recipes.emptyState")} />
        ) : (
          <ul className="grid grid-cols-1 gap-4 sm:grid-cols-2 sm:gap-6 lg:grid-cols-3">
            {visible.map((prompt) => (
              <li key={prompt.slug}>
                <PromptCard prompt={prompt} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
