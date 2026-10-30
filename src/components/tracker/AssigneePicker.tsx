import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useRoster } from "@/lib/users";

const NOBODY = "__nobody__";

/**
 * Hand a part or a to-do to someone. Mentors only — the screens decide
 * whether to render it; this just does the picking.
 */
export function AssigneePicker({
  value,
  onChange,
  label,
}: {
  /** The Clerk id of whoever has it, if anyone. */
  value?: string;
  onChange: (userId: string | null) => void;
  label: string;
}) {
  const roster = useRoster();

  return (
    <Select
      value={value ?? NOBODY}
      onValueChange={(next) => onChange(next === NOBODY ? null : next)}
    >
      <SelectTrigger className="w-52" aria-label={label}>
        <SelectValue placeholder="Nobody" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={NOBODY}>Nobody</SelectItem>
        {(roster ?? []).map((person) => (
          <SelectItem key={person.authId} value={person.authId}>
            {person.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
