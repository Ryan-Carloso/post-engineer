import { GITHUB_URL, LANDING_DESCRIPTION, OG_IMAGE_PATH, SITE_URL } from '@/lib/seo';

export const ORGANIZATION_ID = `${SITE_URL}/#organization`;
export const WEBSITE_ID = `${SITE_URL}/#website`;

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

export interface SoftwareApplicationJsonLd {
  '@context': 'https://schema.org';
  '@type': 'SoftwareApplication';
  '@id': string;
  name: string;
  url: string;
  description: string;
  applicationCategory: string;
  operatingSystem: string;
  image: string;
  publisher: { '@id': string };
}

export function buildOrganizationJsonLd(): OrganizationJsonLd {
  return {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    '@id': ORGANIZATION_ID,
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
    '@id': WEBSITE_ID,
    name: 'Post Engineer',
    url: SITE_URL,
  };
}

export function buildSoftwareApplicationJsonLd(): SoftwareApplicationJsonLd {
  return {
    '@context': 'https://schema.org',
    '@type': 'SoftwareApplication',
    '@id': `${SITE_URL}/landing#software-application`,
    name: 'Post Engineer',
    url: `${SITE_URL}/landing`,
    description: LANDING_DESCRIPTION,
    applicationCategory: 'MultimediaApplication',
    operatingSystem: 'Web',
    image: `${SITE_URL}${OG_IMAGE_PATH}`,
    publisher: { '@id': ORGANIZATION_ID },
  };
}
