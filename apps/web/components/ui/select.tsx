"use client"

import * as React from "react"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectItemIndicator,
  SelectTrigger,
  SelectValue,
} from "@ui-sdk/react/select"
import { Check, ChevronDown } from "lucide-react"

import { cn } from "@/lib/utils"

interface SelectFieldOption {
  value: string
  label: string
  disabled?: boolean
}

interface SelectFieldProps {
  id?: string
  value: string | null
  options: SelectFieldOption[]
  onValueChange: (value: string) => void
  disabled?: boolean
  placeholder?: string
  className?: string
  "aria-label"?: string
  "data-testid"?: string
}

function SelectField({
  value,
  options,
  onValueChange,
  disabled,
  placeholder,
  className,
  ...triggerProps
}: SelectFieldProps) {
  return (
    <Select<string, false>
      value={value}
      items={options}
      placeholder={placeholder}
      disabled={disabled}
      onValueChange={(next) => {
        if (next !== null) onValueChange(next)
      }}
    >
      <SelectTrigger
        className={cn(
          "flex w-full items-center justify-between gap-2 rounded-lg border border-line bg-card px-3.5 py-2.5 text-left text-sm text-ink transition-colors focus:border-ink focus:outline-none focus:ring-2 focus:ring-ink/10 disabled:cursor-not-allowed disabled:opacity-50 data-[placeholder]:text-faint [&>span]:line-clamp-1",
          className
        )}
        {...triggerProps}
      >
        <SelectValue />
        <ChevronDown aria-hidden className="h-4 w-4 shrink-0 opacity-50" />
      </SelectTrigger>
      <SelectContent
        sideOffset={4}
        alignItemWithTrigger={false}
        className="z-50 m-0 max-h-[min(var(--available-height),20rem)] min-w-[var(--anchor-width)] overflow-y-auto overflow-x-hidden overscroll-contain rounded-xl border border-line bg-popover p-1 text-popover-foreground shadow-lg outline-none"
      >
        {options.map((option) => (
          <SelectItem
            key={option.value}
            value={option.value}
            disabled={option.disabled}
            className="relative flex w-full cursor-default select-none items-center rounded-md py-1.5 pl-8 pr-2 text-sm outline-none data-[highlighted]:bg-sunken data-[highlighted]:text-primary data-[disabled]:pointer-events-none data-[disabled]:opacity-50"
          >
            <SelectItemIndicator className="absolute left-2 flex h-3.5 w-3.5 items-center justify-center">
              <Check aria-hidden className="h-4 w-4" />
            </SelectItemIndicator>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

export { SelectField }
