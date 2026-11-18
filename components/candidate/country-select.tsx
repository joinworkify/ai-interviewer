"use client";

import { Check, ChevronsUpDown } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { COUNTRY_PHONE_CONFIGS, getCountryConfig } from "@/lib/candidate/resume-form";
import { cn } from "@/lib/utils";

/** Searchable country calling code picker (shadcn Popover + Command combobox). */
export function CountrySelect({
  value,
  onChange,
}: {
  /** Dial code such as "+95". */
  value: string;
  onChange: (dialCode: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const selected = getCountryConfig(value);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          aria-label="Country calling code"
          className="h-[42px] min-w-[150px] max-w-[50%] shrink-0 justify-between gap-2 rounded-xl border-input bg-background px-3 text-sm font-normal text-foreground shadow-none hover:bg-muted/50 hover:text-foreground"
        >
          <span className="truncate">
            {selected.flag} {selected.name} ({selected.dialCode})
          </span>
          <ChevronsUpDown className="h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      {/* The popover renders in a portal outside the themed layout, so re-apply the
          theme and a light colour scheme (keeps the scrollbar light on a dark OS). */}
      <PopoverContent
        className="theme-datasea w-[280px] p-0 [color-scheme:light]"
        align="start"
      >
        <Command>
          <CommandInput placeholder="Search country or code" />
          <CommandList>
            <CommandEmpty>No country found.</CommandEmpty>
            <CommandGroup>
              {COUNTRY_PHONE_CONFIGS.map((country) => (
                <CommandItem
                  key={country.iso}
                  // The search matches against this text, not the dial code alone.
                  value={`${country.name} ${country.dialCode} ${country.iso}`}
                  onSelect={() => {
                    onChange(country.dialCode);
                    setOpen(false);
                  }}
                >
                  <span className="mr-2">{country.flag}</span>
                  <span className="flex-1 truncate">{country.name}</span>
                  <span className="text-muted-foreground">{country.dialCode}</span>
                  <Check
                    className={cn(
                      "ml-2 h-4 w-4",
                      country.dialCode === value ? "opacity-100" : "opacity-0",
                    )}
                  />
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
