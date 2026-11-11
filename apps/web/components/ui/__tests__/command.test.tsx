import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

//---------------
// Tests for the vendored shadcn Command (cmdk): the root/input/list/
// group/item classes, live filtering, and the empty state.
//---------------

import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '../command';

// cmdk scrolls the selected item into view; jsdom has no
// Element.scrollIntoView, so stub it.
window.HTMLElement.prototype.scrollIntoView = vi.fn();

function renderCommand(onSelect: (value: string) => void = vi.fn()): void {
  render(
    <Command>
      <CommandInput placeholder="Search networks" />
      <CommandList>
        <CommandEmpty>No results</CommandEmpty>
        <CommandGroup heading="Networks">
          <CommandItem value="Alpha" onSelect={() => onSelect('Alpha')}>Alpha</CommandItem>
          <CommandItem value="Beta" onSelect={() => onSelect('Beta')}>Beta</CommandItem>
        </CommandGroup>
      </CommandList>
    </Command>,
  );
}

describe('Command', () => {
  it('renders the root with the popover background classes', () => {
    const { container } = render(
      <Command>
        <CommandList>
          <CommandEmpty>Nothing here</CommandEmpty>
        </CommandList>
      </Command>,
    );
    const root = container.querySelector('[cmdk-root]') as HTMLElement;
    expect(root.className).toContain('bg-popover');
    expect(root.className).toContain('flex-col');
  });

  it('renders the input with the search icon and its classes', () => {
    renderCommand();
    const input = screen.getByPlaceholderText('Search networks');
    expect(input.className).toContain('h-11');
    expect(input.closest('div')?.querySelector('svg.lucide-search')).not.toBeNull();
  });

  it('caps the list height', () => {
    const { container } = render(
      <Command>
        <CommandList>
          <CommandEmpty>Nothing here</CommandEmpty>
        </CommandList>
      </Command>,
    );
    const list = container.querySelector('[cmdk-list]') as HTMLElement;
    expect(list.className).toContain('max-h-[300px]');
  });

  it('renders the group with the foreground text classes', () => {
    renderCommand();
    const group = screen.getByText('Networks').closest('[cmdk-group]') as HTMLElement;
    expect(group.className).toContain('text-foreground');
    expect(group.className).toContain('p-1');
  });

  it('renders items with their base classes', () => {
    renderCommand();
    const item = screen.getByRole('option', { name: 'Alpha' });
    expect(item.className).toContain('gap-2');
    expect(item.className).toContain('px-2');
  });

  it('filters the items as you type and shows the empty state', () => {
    renderCommand();
    fireEvent.change(screen.getByPlaceholderText('Search networks'), { target: { value: 'zzz' } });
    expect(screen.queryByRole('option', { name: 'Alpha' })).toBeNull();
    expect(screen.queryByRole('option', { name: 'Beta' })).toBeNull();
    expect(screen.getByText('No results')).toBeInTheDocument();
  });

  it('calls onSelect when an item is clicked', () => {
    const onSelect = vi.fn();
    renderCommand(onSelect);
    fireEvent.click(screen.getByRole('option', { name: 'Beta' }));
    expect(onSelect).toHaveBeenCalledWith('Beta');
  });
});
