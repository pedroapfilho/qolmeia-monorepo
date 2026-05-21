// JSON Schema shapes we render natively. Anything else falls through to
// the JSON-textarea escape hatch.
type JsonSchemaPrimitiveType = "boolean" | "integer" | "number" | "string";
type JsonSchemaType = JsonSchemaPrimitiveType | "array" | "null" | "object";

type JsonSchema = {
  $ref?: string;
  allOf?: ReadonlyArray<JsonSchema>;
  anyOf?: ReadonlyArray<JsonSchema>;
  description?: string;
  enum?: ReadonlyArray<string>;
  items?: JsonSchema;
  maximum?: number;
  maxLength?: number;
  minimum?: number;
  minLength?: number;
  multipleOf?: number;
  nullable?: boolean;
  oneOf?: ReadonlyArray<JsonSchema>;
  properties?: Readonly<Record<string, JsonSchema>>;
  required?: ReadonlyArray<string>;
  title?: string;
  type?: JsonSchemaType | ReadonlyArray<JsonSchemaType>;
};

type FieldRendererProps = {
  isRequired: boolean;
  onChange: (next: unknown) => void;
  path: string;
  schema: JsonSchema;
  value: unknown;
};

// Picks a single concrete type from a "type" field that may be:
// - omitted (we fall back to "object")
// - a string ("string", "number", ...)
// - an array (["string", "null"]) — we treat ["X", "null"] as nullable X.
const resolveType = (schema: JsonSchema): { isNullable: boolean; type: JsonSchemaType } => {
  if (Array.isArray(schema.type)) {
    const concrete = schema.type.find((t) => t !== "null") ?? "object";
    const isNullable = schema.type.includes("null");
    return { isNullable, type: concrete as JsonSchemaType };
  }
  return {
    isNullable: schema.nullable === true,
    type: (schema.type ?? "object") as JsonSchemaType,
  };
};

// Heuristic: if `maxLength > 200` OR the description hints at multiple
// lines, surface a textarea instead of a single-line input.
const isMultilineString = (schema: JsonSchema): boolean => {
  if (typeof schema.maxLength === "number" && schema.maxLength > 200) {
    return true;
  }
  const hint = schema.description?.toLowerCase() ?? "";
  return hint.includes("multi-line") || hint.includes("multiline") || hint.includes("parágrafo");
};

const labelFor = (key: string, schema: JsonSchema): string => {
  return schema.title ?? key;
};

// We fall through to the JSON textarea when the schema uses combinators or
// refs we don't yet render. The list mirrors the TODO in JsonFallbackField.
const isFallbackShape = (schema: JsonSchema): boolean => {
  if (schema.type !== undefined) {
    return false;
  }
  return Boolean(schema.oneOf || schema.anyOf || schema.allOf || schema.$ref);
};

// Basic shape check that mirrors the renderable cases. The API still runs
// its full Zod validation, so this layer just protects against obvious
// client-side mistakes (e.g. a number field that ended up as "abc").
const isShapeValid = (schema: JsonSchema, value: unknown): boolean => {
  const { isNullable, type } = resolveType(schema);
  if (value === null || value === undefined) {
    return isNullable || value === undefined;
  }
  if (type === "string") {
    return typeof value === "string";
  }
  if (type === "number" || type === "integer") {
    return typeof value === "number" && Number.isFinite(value);
  }
  if (type === "boolean") {
    return typeof value === "boolean";
  }
  if (type === "array") {
    if (!Array.isArray(value)) {
      return false;
    }
    if (schema.items) {
      return value.every((v) => isShapeValid(schema.items as JsonSchema, v));
    }
    return true;
  }
  if (type === "object") {
    if (typeof value !== "object" || Array.isArray(value)) {
      return false;
    }
    const props = schema.properties ?? {};
    return Object.entries(props).every(([k, child]) =>
      isShapeValid(child, (value as Record<string, unknown>)[k]),
    );
  }
  return true;
};

const defaultForType = (type: JsonSchemaType): unknown => {
  if (type === "string") {
    return "";
  }
  if (type === "array") {
    return [];
  }
  if (type === "object") {
    return {};
  }
  if (type === "boolean") {
    return false;
  }
  return 0;
};

export { defaultForType, isFallbackShape, isMultilineString, isShapeValid, labelFor, resolveType };
export type { FieldRendererProps, JsonSchema, JsonSchemaType };
