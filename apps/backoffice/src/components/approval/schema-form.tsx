"use client";

import { Button } from "@repo/ui/components/button";
import { useState } from "react";

import {
  ArrayField,
  BooleanField,
  JsonFallbackField,
  NumberField,
  ObjectField,
  type RecursiveProps,
  StringField,
} from "./schema-fields";
import {
  defaultForType,
  type FieldRendererProps,
  isFallbackShape,
  isShapeValid,
  type JsonSchema,
  labelFor,
  resolveType,
} from "./schema-types";

type SchemaFormProps = {
  initialValue: unknown;
  onCancel: () => void;
  onSubmit: (newValue: unknown) => Promise<void>;
  schema: unknown;
};

// Dispatcher — picks the right renderer for the schema's resolved type.
// Object/Array renderers recurse via the `Renderer` prop so the recursion
// is parameterised (no forward-references inside schema-fields).
const SchemaField = (props: FieldRendererProps) => {
  const { isNullable, type } = resolveType(props.schema);
  const { onChange, value } = props;

  // Wrap nullable fields with a "limpar" toggle. When cleared, value is null.
  if (isNullable && type !== "boolean") {
    const isCleared = value === null;
    const handleToggle = () => {
      if (isCleared) {
        onChange(defaultForType(type));
        return;
      }
      onChange(null);
    };
    return (
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium">{labelFor(props.path, props.schema)}</span>
          <button
            className="text-xs text-muted-foreground underline-offset-4 hover:underline"
            onClick={handleToggle}
            type="button"
          >
            {isCleared ? "definir" : "limpar"}
          </button>
        </div>
        {!isCleared && <SchemaField {...props} schema={{ ...props.schema, nullable: false }} />}
      </div>
    );
  }

  const recursive: RecursiveProps = { ...props, Renderer: SchemaField };

  if (isFallbackShape(props.schema)) {
    return <JsonFallbackField {...props} />;
  }
  if (type === "string") {
    return <StringField {...props} />;
  }
  if (type === "number" || type === "integer") {
    return <NumberField {...props} />;
  }
  if (type === "boolean") {
    return <BooleanField {...props} />;
  }
  if (type === "array") {
    return <ArrayField {...recursive} />;
  }
  if (type === "object") {
    return <ObjectField {...recursive} />;
  }
  return <JsonFallbackField {...props} />;
};

const SchemaForm = ({ initialValue, onCancel, onSubmit, schema }: SchemaFormProps) => {
  const rootSchema = (schema as JsonSchema) ?? { type: "object" as const };
  const [value, setValue] = useState<unknown>(initialValue ?? {});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    event.stopPropagation();
    if (isSubmitting) {
      return;
    }
    setFormError(null);
    if (!isShapeValid(rootSchema, value)) {
      setFormError("Os campos não estão no formato esperado.");
      return;
    }
    setIsSubmitting(true);
    try {
      await onSubmit(value);
    } catch (error) {
      setFormError(error instanceof Error ? error.message : "Falha ao salvar.");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <form className="flex flex-col gap-5" noValidate onSubmit={handleSubmit}>
      <SchemaField
        isRequired={false}
        onChange={setValue}
        path=""
        schema={rootSchema}
        value={value}
      />
      {formError && (
        <p className="text-sm font-medium text-destructive" role="alert">
          {formError}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <Button disabled={isSubmitting} onClick={onCancel} type="button" variant="ghost">
          Cancelar
        </Button>
        <Button disabled={isSubmitting} type="submit">
          {isSubmitting ? "Salvando..." : "Salvar edição"}
        </Button>
      </div>
    </form>
  );
};

export { SchemaForm };
export type { JsonSchema, SchemaFormProps };
