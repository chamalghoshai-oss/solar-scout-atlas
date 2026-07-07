import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SCOPES } from "@/lib/scopes";
import { Globe2 } from "lucide-react";

export function ScopeSelector({ value, onChange }: { value: string; onChange: (id: string) => void }) {
  const groups: Array<{ label: string; group: "District" | "State" | "Country" | "Global" }> = [
    { label: "Districts (Kerala)", group: "District" },
    { label: "State", group: "State" },
    { label: "Country", group: "Country" },
    { label: "Global", group: "Global" },
  ];
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="h-8 gap-1 rounded-full border border-border bg-background/95 px-3 text-xs shadow-sm backdrop-blur">
        <Globe2 className="h-3.5 w-3.5 text-primary" />
        <SelectValue placeholder="Area" />
      </SelectTrigger>
      <SelectContent className="max-h-[60vh]">
        {groups.map((g) => {
          const items = SCOPES.filter((s) => s.group === g.group);
          if (items.length === 0) return null;
          return (
            <SelectGroup key={g.group}>
              <SelectLabel>{g.label}</SelectLabel>
              {items.map((s) => (
                <SelectItem key={s.id} value={s.id}>{s.label}</SelectItem>
              ))}
            </SelectGroup>
          );
        })}
      </SelectContent>
    </Select>
  );
}