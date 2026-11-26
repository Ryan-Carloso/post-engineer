import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SlotImagePreview } from '@/app/(main)/posts/[id]/slot-image-preview';

vi.mock('@/lib/i18n/provider', () => {
  const t = (key: string) => key;
  return { useI18n: () => ({ t, locale: 'en', setLocale: vi.fn() }) };
});

describe('app/(main)/posts/[id]/slot-image-preview — SlotImagePreview', () => {
  it('renders the uploaded image with its translated alt text', () => {
    render(<SlotImagePreview src="https://example.com/image.jpg" />);
    const image = screen.getByAltText('posts.uploadedImage');
    expect(image).toBeInTheDocument();
    expect(image).toHaveAttribute('src', 'https://example.com/image.jpg');
  });
});
