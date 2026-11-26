import Link from 'next/link';
import { PROVIDER_LABELS } from '@/lib/account-options';
import { localize, type DocBlock, type DocLocale, type DocPage, type LocalizedText } from '@/lib/docs/types';
import { VIDEO_TYPES, computeVideoTokens, type FaceQuality } from '@/lib/tokens';
import { TOOL_DESCRIPTIONS } from '@/scripts/llms-full-content.mjs';

function DocLink({ href, text, locale }: { href: LocalizedText; text: string; locale: DocLocale }) {
  const url = localize(href, locale);
  if (url.startsWith('/')) {
    return (
      <Link href={url} className="font-medium text-brand hover:underline">
        {text}
      </Link>
    );
  }
  return (
    <a href={url} target="_blank" rel="noreferrer" className="font-medium text-brand hover:underline">
      {text}
    </a>
  );
}

function renderBlock(block: DocBlock, locale: DocLocale, key: string) {
  if (block.kind === 'heading') {
    if (block.level === 2) {
      return (
        <h2 key={key} className="mt-8 text-xl font-bold tracking-tight text-ink">
          {localize(block.text, locale)}
        </h2>
      );
    }
    return (
      <h3 key={key} className="mt-6 text-lg font-bold tracking-tight text-ink">
        {localize(block.text, locale)}
      </h3>
    );
  }
  if (block.kind === 'paragraph') {
    return (
      <p key={key} className="mt-4 leading-relaxed text-ink-soft">
        {localize(block.text, locale)}
      </p>
    );
  }
  if (block.kind === 'list') {
    return (
      <ul key={key} className="mt-4 list-disc space-y-2 pl-6 leading-relaxed text-ink-soft">
        {block.items.map((item, index) => (
          <li key={`${localize(item, locale).slice(0, 24)}-${index}`}>{localize(item, locale)}</li>
        ))}
      </ul>
    );
  }
  if (block.kind === 'code') {
    return (
      <pre
        key={key}
        className="mt-4 overflow-x-auto rounded-xl bg-surface p-4 text-sm leading-relaxed text-ink"
      >
        <code>{block.code}</code>
      </pre>
    );
  }
  if (block.kind === 'link') {
    return (
      <p key={key} className="mt-4 leading-relaxed">
        <DocLink href={block.href} text={localize(block.text, locale)} locale={locale} />
      </p>
    );
  }
  if (block.kind === 'toolList') {
    return (
      <dl key={key} className="mt-4 space-y-3">
        {TOOL_DESCRIPTIONS.map(([name, description]) => (
          <div key={name}>
            <dt>
              <code className="rounded bg-surface px-1.5 py-0.5 text-sm font-semibold text-ink">{name}</code>
            </dt>
            <dd className="mt-1 leading-relaxed text-ink-soft">{description}</dd>
          </div>
        ))}
      </dl>
    );
  }
  if (block.kind === 'providerList') {
    return (
      <ul key={key} className="mt-4 list-disc space-y-2 pl-6 leading-relaxed text-ink-soft">
        {block.providers.map((provider) => (
          <li key={provider}>{PROVIDER_LABELS[provider]}</li>
        ))}
      </ul>
    );
  }
  const rows: Array<{ type: string; quality: string; tokens: number }> = [];
  for (const videoType of VIDEO_TYPES) {
    if (videoType === 'voiceover') {
      rows.push({ type: videoType, quality: 'any', tokens: computeVideoTokens(videoType, 'ok') });
      continue;
    }
    const qualities: FaceQuality[] = ['ok', 'very_good'];
    for (const quality of qualities) {
      rows.push({ type: videoType, quality, tokens: computeVideoTokens(videoType, quality) });
    }
  }
  return (
    <table key={key} className="mt-4 w-full text-left text-sm text-ink-soft">
      <thead>
        <tr className="border-b border-hairline text-ink">
          <th className="py-2 pr-4">Video type</th>
          <th className="py-2 pr-4">Face quality</th>
          <th className="py-2">Tokens</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={`${row.type}-${row.quality}`} className="border-b border-hairline">
            <td className="py-2 pr-4">
              <code>{row.type}</code>
            </td>
            <td className="py-2 pr-4">
              <code>{row.quality}</code>
            </td>
            <td className="py-2">{row.tokens}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export default function DocArticle({ page, locale }: { page: DocPage; locale: DocLocale }) {
  const indexPath =
    page.section === 'docs' ? '/docs' : locale === 'en' ? '/en/help' : '/help';
  const indexLabel =
    page.section === 'docs' ? 'Documentation' : locale === 'en' ? 'Help' : 'Ajuda';
  return (
    <div>
      {page.slug !== null && (
        <Link href={indexPath} className="text-sm text-muted-text hover:text-ink">
          ← {indexLabel}
        </Link>
      )}
      <h1 className="mt-6 text-3xl font-bold tracking-tight text-ink sm:text-4xl">
        {localize(page.title, locale)}
      </h1>
      <p className="mt-2 text-sm text-faint">Updated {page.updatedAt}</p>
      <p className="mt-4 leading-relaxed text-ink-soft">{localize(page.description, locale)}</p>
      <div className="mt-8 rounded-3xl border border-hairline bg-card p-6 shadow-sm sm:p-8">
        {page.blocks.map((block, index) => renderBlock(block, locale, `${block.kind}-${index}`))}
      </div>
    </div>
  );
}
