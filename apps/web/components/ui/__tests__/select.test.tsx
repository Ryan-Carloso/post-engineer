import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import { SelectField } from '../select';

const NETWORKS = [
  { value: 'youtube', label: 'YouTube' },
  { value: 'instagram', label: 'Instagram', disabled: true },
  { value: 'tiktok', label: 'TikTok' },
];

async function openSelect(): Promise<HTMLElement> {
  const user = userEvent.setup();
  await user.click(screen.getByRole('combobox'));
  return screen.getByRole('listbox');
}

describe('SelectField styling', () => {
  it('renders the trigger with its base classes, the placeholder and the chevron', () => {
    render(<SelectField id="n" value={null} options={NETWORKS} placeholder="Pick a network" onValueChange={vi.fn()} />);
    const trigger = screen.getByRole('combobox');
    expect(trigger.className).toContain('border-line');
    expect(trigger.className).toContain('bg-card');
    expect(trigger).toHaveTextContent('Pick a network');
    expect(trigger.querySelector('svg.lucide-chevron-down')).not.toBeNull();
  });

  it('merges a caller class over the trigger base classes', () => {
    render(<SelectField id="n" value="youtube" options={NETWORKS} className="px-1" onValueChange={vi.fn()} />);
    const trigger = screen.getByRole('combobox');
    expect(trigger.className).toContain('px-1');
    expect(trigger.className).not.toContain('px-3.5');
  });

  it('carries the popup classes on the content once opened', async () => {
    render(<SelectField id="n" value="youtube" options={NETWORKS} onValueChange={vi.fn()} />);
    const listbox = await openSelect();
    expect(listbox.className).toContain('bg-popover');
    expect(listbox.className).toContain('overflow-y-auto');
  });

  it('shows a check indicator only on the selected option and disables flagged options', async () => {
    render(<SelectField id="n" value="youtube" options={NETWORKS} onValueChange={vi.fn()} />);
    await openSelect();
    expect(screen.getByRole('option', { name: 'YouTube' }).querySelector('svg.lucide-check')).not.toBeNull();
    expect(screen.getByRole('option', { name: 'TikTok' }).querySelector('svg.lucide-check')).toBeNull();
    expect(screen.getByRole('option', { name: 'Instagram' })).toHaveAttribute('aria-disabled', 'true');
  });

  it('shows the label of a value that changes while closed', () => {
    const { rerender } = render(<SelectField id="n" value="youtube" options={NETWORKS} onValueChange={vi.fn()} />);
    rerender(<SelectField id="n" value="tiktok" options={NETWORKS} onValueChange={vi.fn()} />);
    expect(screen.getByRole('combobox')).toHaveTextContent('TikTok');
  });
});

describe('SelectField behavior', () => {
  const options = [
    { value: '', label: 'No persona' },
    { value: 'p1', label: 'Viva Leve' },
    { value: 'p2', label: 'Other Persona' },
  ];

  function renderField(overrides: { value?: string | null; disabled?: boolean } = {}) {
    const onValueChange = vi.fn();
    render(
      <div>
        <label htmlFor="field-id">Persona</label>
        <SelectField
          id="field-id"
          data-testid="field-test"
          value={overrides.value === undefined ? '' : overrides.value}
          options={options}
          disabled={overrides.disabled}
          placeholder="Choose"
          onValueChange={onValueChange}
        />
      </div>,
    );
    return onValueChange;
  }

  it('names the trigger through its label and shows the selected option, including an empty value', () => {
    renderField();
    const trigger = screen.getByRole('combobox', { name: 'Persona' });
    expect(trigger).toHaveAttribute('id', 'field-id');
    expect(trigger).toHaveAttribute('data-testid', 'field-test');
    expect(trigger).toHaveTextContent('No persona');
  });

  it('shows the placeholder while nothing is selected', () => {
    renderField({ value: null });
    expect(screen.getByRole('combobox')).toHaveTextContent('Choose');
  });

  it('reports the picked value, the empty one too', async () => {
    const onValueChange = renderField({ value: 'p1' });
    const user = userEvent.setup();
    await user.click(screen.getByRole('combobox'));
    await user.click(screen.getByRole('option', { name: 'Other Persona' }));
    expect(onValueChange).toHaveBeenCalledExactlyOnceWith('p2');
    await user.click(screen.getByRole('combobox'));
    await user.click(screen.getByRole('option', { name: 'No persona' }));
    expect(onValueChange).toHaveBeenLastCalledWith('');
  });

  it('selects the matching option by typing on the focused trigger', async () => {
    const onValueChange = renderField({ value: 'p1' });
    const user = userEvent.setup();
    await user.tab();
    await user.keyboard('ot');
    expect(onValueChange).toHaveBeenCalledWith('p2');
  });

  it('does not open while disabled', async () => {
    renderField({ disabled: true });
    const user = userEvent.setup();
    const trigger = screen.getByRole('combobox');
    expect(trigger).toBeDisabled();
    await user.click(trigger);
    expect(screen.queryByRole('listbox')).toBeNull();
  });
});
