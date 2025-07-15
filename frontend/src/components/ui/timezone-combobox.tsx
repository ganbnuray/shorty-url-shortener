"use client";

import { useMemo, useState } from "react";
import { getTimeZones } from "@vvo/tzdb";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { Check, ChevronsUpDown } from "lucide-react";
import { cn } from "@/lib/utils";

const popularZones = [
  "UTC",
  "America/New_York",
  "Europe/London",
  "Asia/Baku",
  "Asia/Tokyo",
];

export function TimezoneCombobox({
  value,
  onChange,
}: {
  value: string;
  onChange: (val: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const timezones = useMemo(() => {
    const allZones = getTimeZones();
    const popular = allZones.filter((tz) => popularZones.includes(tz.name));
    const rest = allZones.filter((tz) => !popularZones.includes(tz.name));
    return [...popular, ...rest];
  }, []);

  const filteredTimezones = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q === "") return timezones;

    return timezones.filter((tz) => {
      const nameNormalized = tz.name.toLowerCase();
      const altNameNormalized = (tz.alternativeName || "").toLowerCase();
      const rawFormatNormalized = tz.rawFormat.toLowerCase();

      const nameMatch = nameNormalized.includes(q);
      const altNameMatch = altNameNormalized.includes(q);
      const rawFormatMatch = rawFormatNormalized.includes(q);

      let offsetMatch = false;

      if (/^[+-]?\d+(\.\d+)?$/.test(q)) {
        const offsetHours = tz.currentTimeOffsetInMinutes / 60;
        const queryNum = parseFloat(q);

        if (q.startsWith("+")) {
          offsetMatch = offsetHours === queryNum;
        } else if (q.startsWith("-")) {
          offsetMatch = offsetHours === queryNum;
        } else {
          offsetMatch = Math.abs(offsetHours) === Math.abs(queryNum);
        }
      }

      return nameMatch || altNameMatch || rawFormatMatch || offsetMatch;
    });
  }, [query, timezones]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          className="w-full justify-between truncate"
        >
          <span className="truncate max-w-[85%] text-left">
            {value
              ? `${value} (${
                  timezones.find((tz) => tz.name === value)
                    ?.currentTimeFormat ?? "default"
                })`
              : "Select timezone"}
          </span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-full p-0 max-h-64 overflow-y-auto">
        <Command shouldFilter={false}>
          <CommandInput
            placeholder="Search timezone..."
            value={query}
            onValueChange={setQuery}
          />
          <CommandEmpty>No results found.</CommandEmpty>
          <CommandGroup>
            {filteredTimezones.map((tz) => (
              <CommandItem
                key={tz.name}
                value={tz.name}
                onSelect={() => {
                  onChange(tz.name);
                  setOpen(false);
                }}
              >
                <Check
                  className={cn(
                    "mr-2 h-4 w-4",
                    value === tz.name ? "opacity-100" : "opacity-0"
                  )}
                />
                {tz.name} ({tz.currentTimeFormat})
              </CommandItem>
            ))}
          </CommandGroup>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
