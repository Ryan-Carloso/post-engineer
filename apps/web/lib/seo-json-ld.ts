import { GITHUB_URL, SITE_URL } from '@/lib/seo';

export interface OrganizationJsonLd {
  '@context': 'https://schema.org';
  '@type': 'Organization';
  '@id': string;
  name: string;
  url: string;
  logo: string;
  sameAs: string[];
}

export interface WebSiteJsonLd {
  '@context': 'https://schema.org';
  '@type': 'WebSite';
  '@id': string;
  name: string;
  url: string;
}

export function buildOrganizationJsonLd(): OrganizationJsonLd {
  return {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    '@id': `${SITE_URL}/#organization`,
    name: 'Post Engineer',
    url: SITE_URL,
    logo: `${SITE_URL}/logo.png`,
    sameAs: [GITHUB_URL],
  };
}

export function buildWebSiteJsonLd(): WebSiteJsonLd {
  return {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    '@id': `${SITE_URL}/#website`,
    name: 'Post Engineer',
    url: SITE_URL,
  };
}
