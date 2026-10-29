"use client";

import Link from "next/link";
import { useI18n } from "@/lib/i18n/provider";
import type { PromptEntry } from "./prompts";
import CopyPromptBlock from "./copy-prompt-block";

//---------------
// PromptDetail — one prompt's detail page content, rendered from
// a PromptEntry. Order is fixed: baby steps first (what the prompt
// does, why it serves, who it is for — short numbered steps, no
// preamble), then what you get, then an example, then the full
// prompt with the big copy button. Nothing is hidden: the steps
// lead for quick understanding, the full text follows for whoever
// wants to read everything. GitHub is only a small secondary link
// at the bottom, never the main action. The steps use short
// sentences and state first; no internal style-skill name appears
// in user-facing copy here — MCP tool names are public and
// expected inside the copy-ready prompt.
//---------------

export default function PromptDetail({ prompt }: { prompt: PromptEntry }) {
  const { t } = useI18n();

  return (
    <div>
      <Link
        href="/recipes"
        className="text-sm text-[#718096] hover:text-[#101728]"
      >
        ← {t("recipes.backToPrompts")}
      </Link>
      <p className="mt-10 text-xs font-bold tracking-[0.2em] text-[#ff544c] uppercase">
        {t(prompt.kindKey)}
      </p>
      <h1 className="mt-3 text-4xl font-black tracking-tight text-[#101728] sm:text-5xl">
        {t(prompt.titleKey)}
      </h1>
      <p className="mt-3 max-w-2xl text-base leading-relaxed text-[#414d63]">
        {t(prompt.objectiveKey)}
      </p>

      <section className="mt-12">
        <h2 className="text-2xl font-bold tracking-tight text-[#101728]">
          {t("recipes.stepsTitle")}
        </h2>
        <ol className="mt-4 list-decimal space-y-3 pl-5">
          {prompt.stepKeys.map((stepKey) => (
            <li key={stepKey} className="leading-relaxed text-[#414d63]">
              {t(stepKey)}
            </li>
          ))}
        </ol>
      </section>

      <section className="mt-12">
        <h2 className="text-2xl font-bold tracking-tight text-[#101728]">
          {t("recipes.deliversTitle")}
        </h2>
        <ul className="mt-4 list-disc space-y-3 pl-5">
          {prompt.deliverKeys.map((deliverKey) => (
            <li key={deliverKey} className="leading-relaxed text-[#414d63]">
              {t(deliverKey)}
            </li>
          ))}
        </ul>
      </section>

      <section className="mt-12">
        <h2 className="text-2xl font-bold tracking-tight text-[#101728]">
          {t("recipes.examplesTitle")}
        </h2>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <div className="rounded-xl border border-[#e3e8ef] bg-white p-4">
            <p className="text-xs font-bold tracking-[0.2em] text-[#718096] uppercase">
              {t("recipes.exampleInputLabel")}
            </p>
            <p className="mt-2 leading-relaxed text-[#414d63]">
              {t(prompt.exampleInputKey)}
            </p>
          </div>
          <div className="rounded-xl border border-[#e3e8ef] bg-white p-4">
            <p className="text-xs font-bold tracking-[0.2em] text-[#718096] uppercase">
              {t("recipes.exampleOutputLabel")}
            </p>
            <p className="mt-2 leading-relaxed text-[#414d63]">
              {t(prompt.exampleOutputKey)}
            </p>
          </div>
        </div>
      </section>

      <CopyPromptBlock prompt={prompt.prompt} />

      <div className="mt-12 border-t border-[#e3e8ef] pt-6">
        <a
          href={prompt.docHref}
          target="_blank"
          rel="noreferrer"
          className="text-sm text-[#718096] hover:text-[#101728] hover:underline"
        >
          {t("recipes.viewOnGithub")}
        </a>
      </div>
    </div>
  );
}
