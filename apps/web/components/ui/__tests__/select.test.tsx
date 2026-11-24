import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

window.HTMLElement.prototype.scrollIntoView = vi.fn();
window.HTMLElement.prototype.hasPointerCapture = () => false;
window.HTMLElement.prototype.setPointerCapture = () => {};
window.HTMLElement.prototype.releasePointerCapture = () => {};

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../select';

function renderSelect(position?: 'popper' | 'item-aligned'): void {
  render(
    <Select>
      <SelectTrigger>
        <SelectValue placeholder="Pick a network" />
      </SelectTrigger>
      <SelectContent {...(position === undefined ? {} : { position })}>
        <SelectItem value="youtube">YouTube</SelectItem>
        <SelectItem value="instagram">Instagram</SelectItem>
      </SelectContent>
    </Select>,
  );
}

async function openSelect(): Promise<HTMLElement> {
  const user = userEvent.setup();
  await user.click(screen.getByRole('combobox'));
  return screen.getByRole('listbox');
}

describe('Select', () => {
  it('renders the trigger with its base classes and the chevron', () => {
    renderSelect();
    const trigger = screen.getByRole('combobox');
    expect(trigger.className).toContain('border-input');
    expect(trigger.className).toContain('h-10');
    expect(trigger.querySelector('svg.lucide-chevron-down')).not.toBeNull();
  });

  it('carries the popper classes on the content and viewport by default', async () => {
    renderSelect();
    const listbox = await openSelect();
    expect(listbox.className).toContain('bg-popover');
    expect(listbox.className).toContain('data-[side=bottom]:translate-y-1');
    const viewport = listbox.querySelector('[data-radix-select-viewport]') as HTMLElement;
    expect(viewport.className).toContain('p-1');
    expect(viewport.className).toContain('h-[var(--radix-select-trigger-height)]');
  });

  it('drops the popper classes with position="item-aligned"', async () => {
    renderSelect('item-aligned');
    const listbox = await openSelect();
    expect(listbox.className).not.toContain('translate-y-1');
    const viewport = listbox.querySelector('[data-radix-select-viewport]') as HTMLElement;
    expect(viewport.className).toContain('p-1');
    expect(viewport.className).not.toContain('h-[var(--radix-select-trigger-height)]');
  });

  it('renders items with their base classes and a check indicator once selected', async () => {
    renderSelect();
    await openSelect();
    const item = screen.getByRole('option', { name: 'YouTube' });
    expect(item.className).toContain('pl-8');
    expect(item.className).toContain('focus:bg-sunken');
    expect(item.className).toContain('focus:text-primary');
    expect(item.className).not.toContain('focus:bg-accent');
    const user = userEvent.setup();
    await user.click(item);
    expect(screen.getByRole('combobox')).toHaveTextContent('YouTube');
    await openSelect();
    const reopened = screen.getByRole('option', { name: 'YouTube' });
    expect(reopened.querySelector('svg.lucide-check')).not.toBeNull();
  });

  it('renders the scroll buttons with their chevrons once the list can scroll', async () => {
    Object.defineProperty(HTMLElement.prototype, 'scrollHeight', { get: () => 1000, configurable: true });
    Object.defineProperty(HTMLElement.prototype, 'clientHeight', { get: () => 100, configurable: true });
    try {
      renderSelect();
      const listbox = await openSelect();
      const viewport = listbox.querySelector('[data-radix-select-viewport]') as HTMLElement;
      await waitFor(() => expect(listbox.querySelector('svg.lucide-chevron-down')).not.toBeNull());
      const downButton = listbox.querySelector('svg.lucide-chevron-down')?.closest('div') as HTMLElement;
      expect(downButton.className).toContain('justify-center');
      expect(downButton.className).toContain('py-1');
      viewport.scrollTop = 10;
      fireEvent.scroll(viewport);
      await waitFor(() => expect(listbox.querySelector('svg.lucide-chevron-up')).not.toBeNull());
      const upButton = listbox.querySelector('svg.lucide-chevron-up')?.closest('div') as HTMLElement;
      expect(upButton.className).toContain('justify-center');
      expect(upButton.className).toContain('py-1');
    } finally {
      delete (HTMLElement.prototype as unknown as Record<string, unknown>).scrollHeight;
      delete (HTMLElement.prototype as unknown as Record<string, unknown>).clientHeight;
    }
  });
});
