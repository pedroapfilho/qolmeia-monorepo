"use client";

import { Button } from "@repo/ui/components/button";
import { Field, FieldDescription, FieldError, FieldLabel } from "@repo/ui/components/field";
import { Input } from "@repo/ui/components/input";
import { Plus, Trash2 } from "lucide-react";
import { type ComponentType, useId, useState } from "react";

import {
  type FieldRendererProps,
  isMultilineString,
  labelFor,
  resolveType,
} from "./schema-types";

// Object/Array renderers need to recurse — they receive the dispatcher via
// the `Renderer` prop so this file can stay free of forward references.
type RecursiveProps = FieldRendererProps & { Renderer: ComponentType<RecursiveProps> };

const StringField = ({ isRequired, onChange, path, schema, value }: FieldRendererProps) => {
  const labelId = useId();
  const stringValue = typeof value === "string" ? value : "";

  if (schema.enum && schema.enum.length > 0) {
    return (
      <Field>
        <FieldLabel htmlFor={labelId}>
          {labelFor(path, schema)}
          {isRequired ? " *" : ""}
        </FieldLabel>
        {schema.description && <FieldDescription>{schema.description}</FieldDescription>}
        <select
          className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 dark:bg-input/30"
          id={labelId}
          onChange={(event) => onChange(event.target.value)}
          value={stringValue}
        >
          {!isRequired && <option value="">— selecionar —</option>}
          {schema.enum.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      </Field>
    );
  }

  if (isMultilineString(schema)) {
    return (
      <Field>
        <FieldLabel htmlFor={labelId}>
          {labelFor(path, schema)}
          {isRequired ? " *" : ""}
        </FieldLabel>
        {schema.description && <FieldDescription>{schema.description}</FieldDescription>}
        <textarea
          className="min-h-32 w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 dark:bg-input/30"
          id={labelId}
          maxLength={schema.maxLength}
          minLength={schema.minLength}
          onChange={(event) => onChange(event.target.value)}
          value={stringValue}
        />
      </Field>
    );
  }

  return (
    <Field>
      <FieldLabel htmlFor={labelId}>
        {labelFor(path, schema)}
        {isRequired ? " *" : ""}
      </FieldLabel>
      {schema.description && <FieldDescription>{schema.description}</FieldDescription>}
      <Input
        id={labelId}
        maxLength={schema.maxLength}
        minLength={schema.minLength}
        onChange={(event) => onChange(event.target.value)}
        type="text"
        value={stringValue}
      />
    </Field>
  );
};

const NumberField = ({ isRequired, onChange, path, schema, value }: FieldRendererProps) => {
  const labelId = useId();
  const { type } = resolveType(schema);
  const step = type === "integer" ? 1 : (schema.multipleOf ?? "any");
  const numericValue = typeof value === "number" ? String(value) : "";

  const handleChange = (raw: string) => {
    if (raw === "") {
      onChange(undefined);
      return;
    }
    const parsed = type === "integer" ? Number.parseInt(raw, 10) : Number.parseFloat(raw);
    if (Number.isNaN(parsed)) {
      return;
    }
    onChange(parsed);
  };

  return (
    <Field>
      <FieldLabel htmlFor={labelId}>
        {labelFor(path, schema)}
        {isRequired ? " *" : ""}
      </FieldLabel>
      {schema.description && <FieldDescription>{schema.description}</FieldDescription>}
      <Input
        id={labelId}
        max={schema.maximum}
        min={schema.minimum}
        onChange={(event) => handleChange(event.target.value)}
        step={step}
        type="number"
        value={numericValue}
      />
    </Field>
  );
};

const BooleanField = ({ onChange, path, schema, value }: FieldRendererProps) => {
  const labelId = useId();
  const checked = value === true;
  return (
    <Field className="flex-row items-center gap-3">
      <input
        checked={checked}
        className="size-4 rounded border-input"
        id={labelId}
        onChange={(event) => onChange(event.target.checked)}
        type="checkbox"
      />
      <FieldLabel htmlFor={labelId}>{labelFor(path, schema)}</FieldLabel>
      {schema.description && <FieldDescription>{schema.description}</FieldDescription>}
    </Field>
  );
};

const ArrayField = ({ onChange, path, Renderer, schema, value }: RecursiveProps) => {
  const items = Array.isArray(value) ? value : [];
  const itemSchema = schema.items ?? { type: "string" as const };

  const handleItemChange = (index: number, next: unknown) => {
    const copy = [...items];
    copy[index] = next;
    onChange(copy);
  };

  const handleRemove = (index: number) => {
    const copy = items.filter((_, i) => i !== index);
    onChange(copy);
  };

  const handleAdd = () => {
    onChange([...items, itemSchema.type === "string" ? "" : null]);
  };

  return (
    <Field>
      <FieldLabel>{labelFor(path, schema)}</FieldLabel>
      {schema.description && <FieldDescription>{schema.description}</FieldDescription>}
      <div className="flex flex-col gap-2">
        {items.map((item, index) => (
          // eslint-disable-next-line react/no-array-index-key -- order matters and items have no stable id
          <div className="flex items-center gap-2" key={index}>
            <div className="flex-1">
              <Renderer
                isRequired={false}
                onChange={(next) => handleItemChange(index, next)}
                path={`${path}[${String(index)}]`}
                Renderer={Renderer}
                schema={itemSchema}
                value={item}
              />
            </div>
            <Button
              aria-label="Remover item"
              onClick={() => handleRemove(index)}
              size="icon-sm"
              type="button"
              variant="ghost"
            >
              <Trash2 />
            </Button>
          </div>
        ))}
        <Button
          className="self-start"
          onClick={handleAdd}
          size="sm"
          type="button"
          variant="outline"
        >
          <Plus />
          adicionar
        </Button>
      </div>
    </Field>
  );
};

const ObjectField = ({ onChange, path, Renderer, schema, value }: RecursiveProps) => {
  const objectValue =
    value !== null && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  const properties = schema.properties ?? {};
  const required = schema.required ?? [];

  const handleChild = (key: string, next: unknown) => {
    if (next === undefined) {
      const copy: Record<string, unknown> = { ...objectValue };
      Reflect.deleteProperty(copy, key);
      onChange(copy);
      return;
    }
    onChange({ ...objectValue, [key]: next });
  };

  return (
    <div className="flex flex-col gap-4">
      {path && <p className="text-sm font-medium">{labelFor(path, schema)}</p>}
      {Object.entries(properties).map(([key, childSchema]) => (
        <Renderer
          isRequired={required.includes(key)}
          key={key}
          onChange={(next) => handleChild(key, next)}
          path={key}
          Renderer={Renderer}
          schema={childSchema}
          value={objectValue[key]}
        />
      ))}
    </div>
  );
};

// TODO: extend schema-form mapping for oneOf/anyOf/allOf/$ref combinators
// and tuple-typed arrays. Today these fall through to the JSON escape hatch.
const JsonFallbackField = ({ onChange, path, schema, value }: FieldRendererProps) => {
  const labelId = useId();
  const [raw, setRaw] = useState(() => JSON.stringify(value ?? null, null, 2));
  const [parseError, setParseError] = useState<string | null>(null);

  const handleChange = (next: string) => {
    setRaw(next);
    try {
      const parsed = JSON.parse(next) as unknown;
      setParseError(null);
      onChange(parsed);
    } catch (error) {
      setParseError(error instanceof Error ? error.message : "JSON inválido");
    }
  };

  return (
    <Field>
      <FieldLabel htmlFor={labelId}>{labelFor(path, schema)}</FieldLabel>
      <FieldDescription>
        Editor JSON bruto (formato não suportado pelo editor visual).
      </FieldDescription>
      <textarea
        className="min-h-32 w-full rounded-md border border-input bg-transparent px-3 py-2 font-mono text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 dark:bg-input/30"
        id={labelId}
        onChange={(event) => handleChange(event.target.value)}
        value={raw}
      />
      {parseError && <FieldError errors={[parseError]} />}
    </Field>
  );
};

export {
  ArrayField,
  BooleanField,
  JsonFallbackField,
  NumberField,
  ObjectField,
  type RecursiveProps,
  StringField,
};
