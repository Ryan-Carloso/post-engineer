import '@testing-library/jest-dom/vitest';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';

vi.mock('next/image', () => ({
  default: ({ alt, src, ...rest }: { alt: string; src: string; [key: string]: unknown }) => (
    <img alt={alt} src={src} {...rest} />
  ),
}));

vi.mock('@/lib/i18n/provider', () => {
  const t = (key: string, vars?: Record<string, string | number>): string =>
    vars === undefined ? key : `${key}(${JSON.stringify(vars)})`;
  function I18nProvider({ children }: { children: ReactNode }) {
    return <>{children}</>;
  }
  I18nProvider.displayName = 'I18nProvider';
  return {
    useI18n: () => ({ t, locale: 'pt' as const, setLocale: vi.fn() }),
    I18nProvider,
  };
});

import { MediaField, type MediaSelection } from '../media-field';
import { I18nProvider } from '@/lib/i18n/provider';

function videoMedia(): MediaSelection {
  return {
    file: new File(['bytes'], 'clip.mp4', { type: 'video/mp4' }),
    contentType: 'video/mp4',
    kind: 'video',
    previewUrl: 'blob:video',
  };
}

function imageMedia(): MediaSelection {
  return {
    file: new File(['bytes'], 'photo.png', { type: 'image/png' }),
    contentType: 'image/png',
    kind: 'image',
    previewUrl: 'blob:image',
  };
}

function renderField(overrides: Partial<Parameters<typeof MediaField>[0]> = {}) {
  const onSelect = vi.fn();
  const onRemove = vi.fn();
  const props: Parameters<typeof MediaField>[0] = {
    media: null,
    issue: null,
    error: null,
    disabled: false,
    onSelect,
    onRemove,
    ...overrides,
  };
  const utils = render(
    <I18nProvider>
      <MediaField {...props} />
    </I18nProvider>,
  );
  return { ...utils, onSelect, onRemove, props };
}

describe('MediaField', () => {
  it('renders the empty state with the label, hint and choose button', () => {
    renderField();
    expect(screen.getByText('composer.mediaLabel')).toBeInTheDocument();
    expect(screen.getByText('composer.mediaHint')).toBeInTheDocument();
    expect(screen.getByText('composer.mediaDrop')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /composer\.mediaChoose/ })).toBeInTheDocument();
    expect(screen.getByTestId('composer-file-input')).toHaveAttribute(
      'accept',
      '.mp4,.mov,.jpg,.jpeg,.png,video/mp4,video/quicktime,image/jpeg,image/png',
    );
  });

  it('calls onSelect with the chosen file and clears the input', () => {
    const { onSelect } = renderField();
    const file = new File(['bytes'], 'clip.mp4', { type: 'video/mp4' });
    const input = screen.getByTestId('composer-file-input') as HTMLInputElement;
    fireEvent.change(input, { target: { files: [file] } });
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith(file);
    expect(input.value).toBe('');
  });

  it('ignores a change with no files', () => {
    const { onSelect } = renderField();
    fireEvent.change(screen.getByTestId('composer-file-input'), { target: { files: [] } });
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('ignores a change with a null file list', () => {
    const { onSelect } = renderField();
    fireEvent.change(screen.getByTestId('composer-file-input'), { target: { files: null } });
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('allows dropping a file by preventing the default drag-over behavior', () => {
    const { onSelect } = renderField();
    const section = screen.getByTestId('composer-media');
    expect(fireEvent.dragOver(section)).toBe(false);
    const file = new File(['bytes'], 'clip.mp4', { type: 'video/mp4' });
    fireEvent.drop(section, { dataTransfer: { files: [file] } });
    expect(onSelect).toHaveBeenCalledWith(file);
  });

  it('ignores drag-over while disabled', () => {
    renderField({ disabled: true });
    expect(fireEvent.dragOver(screen.getByTestId('composer-media'))).toBe(true);
  });

  it('opens the file picker from the choose button', () => {
    const click = vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => undefined);
    try {
      renderField();
      fireEvent.click(screen.getByRole('button', { name: /composer\.mediaChoose/ }));
      expect(click).toHaveBeenCalledTimes(1);
    } finally {
      click.mockRestore();
    }
  });

  it('opens the file picker from the replace button', () => {
    const click = vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(() => undefined);
    try {
      renderField({ media: videoMedia() });
      fireEvent.click(screen.getByRole('button', { name: /composer\.mediaReplace/ }));
      expect(click).toHaveBeenCalledTimes(1);
    } finally {
      click.mockRestore();
    }
  });

  it('renders the video preview with the name, kind and size', () => {
    renderField({ media: videoMedia() });
    expect(screen.getByTestId('composer-video-preview')).toHaveAttribute('src', 'blob:video');
    expect(screen.getByText('clip.mp4')).toBeInTheDocument();
    expect(screen.getByText(/composer\.mediaVideo/)).toBeInTheDocument();
    expect(screen.getByText(/0 KB/)).toBeInTheDocument();
    expect(screen.queryByTestId('composer-image-preview')).not.toBeInTheDocument();
  });

  it('renders the image preview with the file name as alt text', () => {
    renderField({ media: imageMedia() });
    const preview = screen.getByTestId('composer-image-preview');
    expect(preview).toHaveAttribute('alt', 'photo.png');
    expect(preview).toHaveAttribute('src', 'blob:image');
    expect(screen.getByText(/composer\.mediaImage/)).toBeInTheDocument();
    expect(screen.queryByTestId('composer-video-preview')).not.toBeInTheDocument();
  });

  it('calls onRemove when the remove button is clicked', () => {
    const { onRemove } = renderField({ media: videoMedia() });
    fireEvent.click(screen.getByRole('button', { name: /composer\.mediaRemove/ }));
    expect(onRemove).toHaveBeenCalledTimes(1);
  });

  it('accepts a dropped file', () => {
    const { onSelect } = renderField();
    const file = new File(['bytes'], 'clip.mp4', { type: 'video/mp4' });
    fireEvent.drop(screen.getByTestId('composer-media'), {
      dataTransfer: { files: [file] },
    });
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith(file);
  });

  it('ignores drops while disabled', () => {
    const { onSelect } = renderField({ disabled: true });
    const file = new File(['bytes'], 'clip.mp4', { type: 'video/mp4' });
    fireEvent.drop(screen.getByTestId('composer-media'), {
      dataTransfer: { files: [file] },
    });
    expect(onSelect).not.toHaveBeenCalled();
    expect(screen.getByTestId('composer-file-input')).toBeDisabled();
    expect(screen.getByRole('button', { name: /composer\.mediaChoose/ })).toBeDisabled();
  });

  it('disables the replace and remove buttons while disabled', () => {
    renderField({ media: videoMedia(), disabled: true });
    expect(screen.getByRole('button', { name: /composer\.mediaReplace/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: /composer\.mediaRemove/ })).toBeDisabled();
  });

  it('shows the validation issue and the file error', () => {
    renderField({ issue: 'composer.validationMedia', error: 'composer.mediaUnsupported' });
    expect(screen.getByText('composer.validationMedia')).toBeInTheDocument();
    expect(screen.getByText('composer.mediaUnsupported')).toBeInTheDocument();
  });
});
