import { cn } from "@repo/ui/lib/utils";
import type { SkillCatalogEntry } from "@repo/worker-api/contracts";

type TemplateFormSkillPickerProps = {
  busy: boolean;
  loading: boolean;
  onToggle: (id: string) => void;
  selected: ReadonlyArray<string>;
  skills: ReadonlyArray<SkillCatalogEntry>;
};

const TemplateFormSkillPicker = ({
  busy,
  loading,
  onToggle,
  selected,
  skills,
}: TemplateFormSkillPickerProps) => {
  const selectedIds = new Set(selected);

  if (loading) {
    return <p className="text-sm text-muted-foreground">Carregando habilidades…</p>;
  }
  if (skills.length === 0) {
    return <p className="text-sm text-muted-foreground">Nenhuma habilidade disponível.</p>;
  }

  return (
    <div className="grid gap-1.5 sm:grid-cols-2">
      {skills.map((skill) => {
        const checked = selectedIds.has(skill.id);
        return (
          <label
            className={cn(
              "flex cursor-pointer items-start gap-2.5 rounded-lg border p-3 transition-colors",
              checked
                ? "border-primary bg-highlight-surface ring-1 ring-primary/40"
                : "border-border hover:border-input hover:bg-accent",
            )}
            key={skill.id}
          >
            <input
              aria-label={skill.displayName}
              checked={checked}
              className="mt-0.5 size-4 accent-primary"
              disabled={busy}
              onChange={() => {
                onToggle(skill.id);
              }}
              type="checkbox"
            />
            <span className="min-w-0">
              <span className="block text-sm font-medium text-foreground">{skill.displayName}</span>
              <span className="block truncate font-mono text-xs text-muted-foreground">
                {skill.id}
              </span>
            </span>
          </label>
        );
      })}
    </div>
  );
};

export { TemplateFormSkillPicker };
