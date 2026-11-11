import '@testing-library/jest-dom/vitest';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

//---------------
// Tests for the vendored shadcn Tabs and Popover: the list/trigger
// classes, tab activation (including a disabled trigger), and the
// popover content classes with its default center alignment.
//---------------

import { Tabs, TabsList, TabsTrigger } from '../tabs';
import { Popover, PopoverContent, PopoverTrigger } from '../popover';

describe('Tabs', () => {
  it('renders the list with the muted background', () => {
    render(
      <Tabs defaultValue="a">
        <TabsList>
          <TabsTrigger value="a">A</TabsTrigger>
          <TabsTrigger value="b">B</TabsTrigger>
        </TabsList>
      </Tabs>,
    );
    const list = screen.getByRole('tablist');
    expect(list.className).toContain('bg-muted');
    expect(list.className).toContain('h-10');
  });

  it('renders triggers with the active-state classes', () => {
    render(
      <Tabs defaultValue="a">
        <TabsList>
          <TabsTrigger value="a">A</TabsTrigger>
        </TabsList>
      </Tabs>,
    );
    const trigger = screen.getByRole('tab', { name: 'A' });
    expect(trigger.className).toContain('data-[state=active]:bg-background');
    expect(trigger.className).toContain('px-3');
  });

  it('activates a trigger on click and ignores a disabled one', () => {
    const onValueChange = vi.fn();
    render(
      <Tabs defaultValue="a" onValueChange={onValueChange}>
        <TabsList>
          <TabsTrigger value="a">A</TabsTrigger>
          <TabsTrigger value="b">B</TabsTrigger>
          <TabsTrigger value="c" disabled>C</TabsTrigger>
        </TabsList>
      </Tabs>,
    );
    fireEvent.mouseDown(screen.getByRole('tab', { name: 'B' }));
    fireEvent.click(screen.getByRole('tab', { name: 'B' }));
    expect(onValueChange).toHaveBeenCalledWith('b');
    expect(screen.getByRole('tab', { name: 'B' })).toHaveAttribute('data-state', 'active');
    fireEvent.mouseDown(screen.getByRole('tab', { name: 'C' }));
    fireEvent.click(screen.getByRole('tab', { name: 'C' }));
    expect(onValueChange).toHaveBeenCalledTimes(1);
  });
});

describe('Popover', () => {
  it('renders the content with the popover background classes, aligned center by default', () => {
    render(
      <Popover open>
        <PopoverTrigger>Open</PopoverTrigger>
        <PopoverContent>Inside</PopoverContent>
      </Popover>,
    );
    const content = screen.getByText('Inside');
    expect(content.className).toContain('bg-popover');
    expect(content.className).toContain('w-72');
    expect(content).toHaveAttribute('data-align', 'center');
  });
});
