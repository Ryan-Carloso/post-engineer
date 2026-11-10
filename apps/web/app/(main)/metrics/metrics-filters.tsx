'use client';

import { useState } from 'react';
import { Check, ChevronsUpDown, SlidersHorizontal, X } from 'lucide-react';
import { useI18n } from '@/lib/i18n/provider';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from '@/components/ui/sheet';
import type { MetricsQuery } from '@/lib/metrics/metrics-query';
import { isSocialProvider } from '@/lib/providers/registry';

//---------------
// MetricsFilterSheet + ActiveFilterChips — the metrics filters as one
// shadcn Sheet (option 3): a Filters button with an active-count badge
// opens a panel with the two filters; Apply commits the draft, Clear
// resets it, and the applied filters show as removable chips below the
// toolbar. Persona uses a searchable Combobox (long list); network uses
// Select. Account and script angle are not offered here: angle comparison
// belongs to /experiments, and an account is almost always one per network.
//---------------

export const FILTER_ALL = 'all';

export interface FilterOption {
  value: string;
  label: string;
}

export type MetricsFilterPatch = Pick<MetricsQuery, 'personaId' | 'provider'>;

export const EMPTY_FILTERS: MetricsFilterPatch = {
  personaId: null,
  provider: null,
};

interface MetricsFilterSheetProps {
  filters: MetricsFilterPatch;
  onApply: (filters: MetricsFilterPatch) => void;
  personaOptions: FilterOption[];
  providerOptions: FilterOption[];
}

export function MetricsFilterSheet({
  filters,
  onApply,
  personaOptions,
  providerOptions,
}: MetricsFilterSheetProps): React.ReactElement {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<MetricsFilterPatch>(filters);
  const activeCount = countActive(filters);

  const handleOpenChange = (next: boolean): void => {
    // Opening discards any unapplied draft; closing without Apply does too.
    if (next) setDraft(filters);
    setOpen(next);
  };
  const apply = (): void => {
    onApply(draft);
    setOpen(false);
  };
  return (
    <Sheet open={open} onOpenChange={handleOpenChange}>
      <SheetTrigger asChild>
        <Button
          type="button"
          variant="outline"
          aria-label={activeCount > 0 ? t('metrics.filtersActive', { count: activeCount }) : t('metrics.filtersButton')}
        >
          <SlidersHorizontal />
          {t('metrics.filtersButton')}
          {activeCount > 0 && <Badge className="ml-1 rounded-full px-1.5">{activeCount}</Badge>}
        </Button>
      </SheetTrigger>
      <SheetContent className="flex flex-col gap-4">
        <SheetHeader>
          <SheetTitle>{t('metrics.filtersTitle')}</SheetTitle>
          <SheetDescription>{t('metrics.filtersDescription')}</SheetDescription>
        </SheetHeader>
        <div className="flex flex-1 flex-col gap-4 overflow-y-auto">
          <FilterCombobox
            label={t('metrics.filterPersona')}
            value={draft.personaId ?? FILTER_ALL}
            options={personaOptions}
            searchPlaceholder={t('metrics.filtersSearchPersona')}
            onChange={(value) => setDraft((current) => ({ ...current, personaId: value === FILTER_ALL ? null : value }))}
          />
          <FilterSelectField
            label={t('metrics.filterProvider')}
            value={draft.provider ?? FILTER_ALL}
            onChange={(value) => setDraft((current) => ({
              ...current,
              provider: isSocialProvider(value) ? value : null,
            }))}
          >
            {providerOptions.map((option) => (
              <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
            ))}
          </FilterSelectField>
        </div>
        <SheetFooter>
          <Button type="button" variant="outline" onClick={() => setDraft(EMPTY_FILTERS)}>
            {t('metrics.clearFilters')}
          </Button>
          <Button type="button" onClick={apply}>
            {t('metrics.filtersApply')}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

export function countActive(filters: MetricsFilterPatch): number {
  return [filters.personaId, filters.provider]
    .filter((value) => value !== null).length;
}

interface FilterComboboxProps {
  label: string;
  value: string;
  options: FilterOption[];
  searchPlaceholder: string;
  onChange: (value: string) => void;
}

function FilterCombobox({ label, value, options, searchPlaceholder, onChange }: FilterComboboxProps): React.ReactElement {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const selected = options.find((option) => option.value === value);
  const triggerLabel = value === FILTER_ALL ? t('metrics.filterAll') : (selected?.label ?? value);
  return (
    <div className="flex flex-col gap-1.5">
      <Label>{label}</Label>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            role="combobox"
            aria-expanded={open}
            aria-label={label}
            className="w-full justify-between font-medium"
          >
            <span className="truncate">{triggerLabel}</span>
            <ChevronsUpDown className="shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
          <Command>
            <CommandInput placeholder={searchPlaceholder} />
            <CommandList>
              <CommandEmpty>{t('metrics.filtersNoResults')}</CommandEmpty>
              <CommandGroup>
                <CommandItem value={FILTER_ALL} onSelect={() => { onChange(FILTER_ALL); setOpen(false); }}>
                  <Check className={cn('size-4', value === FILTER_ALL ? 'opacity-100' : 'opacity-0')} />
                  {t('metrics.filterAll')}
                </CommandItem>
                {options.map((option) => (
                  <CommandItem
                    key={option.value}
                    value={option.label}
                    onSelect={() => { onChange(option.value); setOpen(false); }}
                  >
                    <Check className={cn('size-4', value === option.value ? 'opacity-100' : 'opacity-0')} />
                    {option.label}
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  );
}

interface FilterSelectFieldProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  children: React.ReactNode;
}

function FilterSelectField({ label, value, onChange, children }: FilterSelectFieldProps): React.ReactElement {
  const { t } = useI18n();
  return (
    <div className="flex flex-col gap-1.5">
      <Label>{label}</Label>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger aria-label={label} className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={FILTER_ALL}>{t('metrics.filterAll')}</SelectItem>
          {children}
        </SelectContent>
      </Select>
    </div>
  );
}

export interface ActiveFilter {
  key: keyof MetricsFilterPatch;
  label: string;
}

interface ActiveFilterChipsProps {
  filters: ActiveFilter[];
  onRemove: (key: keyof MetricsFilterPatch) => void;
  onClearAll: () => void;
}

export function ActiveFilterChips({ filters, onRemove, onClearAll }: ActiveFilterChipsProps): React.ReactElement {
  const { t } = useI18n();
  return (
    <div className="flex flex-wrap items-center gap-2">
      {filters.map((filter) => (
        <Badge key={filter.key} variant="secondary" className="gap-1 py-1 pr-1 pl-2.5">
          {filter.label}
          <button
            type="button"
            aria-label={t('metrics.filtersRemoveFilter', { label: filter.label })}
            onClick={() => onRemove(filter.key)}
            className="flex size-4 items-center justify-center rounded-full hover:bg-accent"
          >
            <X className="size-3" />
          </button>
        </Badge>
      ))}
      <Button type="button" variant="link" size="sm" className="h-auto p-0" onClick={onClearAll}>
        {t('metrics.clearFilters')}
      </Button>
    </div>
  );
}
