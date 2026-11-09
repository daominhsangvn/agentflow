"use client";

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@repo/design-system/components/ui/select";

export type FilterSelectOption = { value: string; label: string };

export type FilterSelectProps = {
  /** Accessible name, also the placeholder shown for "no filter". */
  label: string;
  /** Text of the "no filter" option; defaults to `All <label>`. */
  allLabel?: string;
  /** Selected option value; undefined means "all". */
  value: string | undefined;
  options: readonly FilterSelectOption[];
  onChange: (value: string | undefined) => void;
};

const ALL_VALUE = "__all__";

/** A compact "All X" filter dropdown shared by the org-wide list pages. */
export function FilterSelect({
  label,
  allLabel,
  value,
  options,
  onChange,
}: Readonly<FilterSelectProps>) {
  return (
    <Select
      onValueChange={(next) => onChange(next === ALL_VALUE ? undefined : next)}
      value={value ?? ALL_VALUE}
    >
      <SelectTrigger aria-label={label} className="w-48">
        <SelectValue placeholder={label} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ALL_VALUE}>
          {allLabel ?? `All ${label.toLowerCase()}`}
        </SelectItem>
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
