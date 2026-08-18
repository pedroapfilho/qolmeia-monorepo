import { defineTool, type JsonValue, type ToolDefinition } from "@flue/runtime";
import * as v from "valibot";
import * as z from "zod";
import type { ZodType } from "zod";

import { resolveSkills, type SkillContext, type SkillOverlayMap } from "#/skills/registry";

type JsonSchemaNode = {
  description?: string;
  enum?: ReadonlyArray<unknown>;
  format?: string;
  items?: JsonSchemaNode;
  maxLength?: number;
  minLength?: number;
  properties?: Record<string, JsonSchemaNode>;
  required?: ReadonlyArray<string>;
  type?: string;
};

type AnySchema = v.GenericSchema<unknown, unknown>;

const describe = (schema: AnySchema, description: string | undefined): AnySchema =>
  description === undefined ? schema : v.pipe(schema, v.description(description));

const convertString = (node: JsonSchemaNode): AnySchema => {
  let schema: v.GenericSchema<string, string> = v.string();
  if (node.minLength !== undefined) {
    schema = v.pipe(schema, v.minLength(node.minLength));
  }
  if (node.maxLength !== undefined) {
    schema = v.pipe(schema, v.maxLength(node.maxLength));
  }
  if (node.format === "uri") {
    schema = v.pipe(schema, v.url());
  }
  return schema;
};

const convertEnum = (values: ReadonlyArray<unknown>, path: string): AnySchema => {
  const options = values.filter((value): value is string => typeof value === "string");
  if (options.length === 0 || options.length !== values.length) {
    throw new Error(`Skill input schema: unsupported non-string enum at ${path}`);
  }
  return v.picklist(options);
};

const convert = (node: JsonSchemaNode, path: string): AnySchema => {
  if (node.enum !== undefined) {
    return describe(convertEnum(node.enum, path), node.description);
  }
  switch (node.type) {
    case "array": {
      if (!node.items) {
        throw new Error(`Skill input schema: array without items at ${path}`);
      }
      return describe(v.array(convert(node.items, `${path}[]`)), node.description);
    }
    case "boolean": {
      return describe(v.boolean(), node.description);
    }
    case "integer":
    case "number": {
      return describe(v.number(), node.description);
    }
    case "object": {
      const required = new Set(node.required);
      const entries: v.ObjectEntries = {};
      for (const [key, child] of Object.entries(node.properties ?? {})) {
        const converted = convert(child, `${path}.${key}`);
        entries[key] = required.has(key) ? converted : v.optional(converted);
      }
      return describe(v.object(entries), node.description);
    }
    case "string": {
      return describe(convertString(node), node.description);
    }
    case undefined: {
      throw new Error(`Skill input schema: unsupported node without a type at ${path}`);
    }
    default: {
      throw new Error(`Skill input schema: unsupported node at ${path} (type: ${node.type})`);
    }
  }
};

const buildInputSchema = (
  schema: ZodType,
  skillId: string,
): v.GenericSchema<Record<string, unknown>, unknown> => {
  // SAFETY: JsonSchemaNode is an all-optional view and convert validates every field it reads.
  // oxlint-disable-next-line no-unsafe-type-assertion
  const node = z.toJSONSchema(schema) as JsonSchemaNode;
  if (node.type !== "object") {
    throw new Error(`Skill "${skillId}" input schema must be a top-level object`);
  }
  // SAFETY: The checked object node makes convert return a record-producing schema.
  // oxlint-disable-next-line no-unsafe-type-assertion
  return convert(node, skillId) as v.GenericSchema<Record<string, unknown>, unknown>;
};

const buildFlueTools = (
  ctx: SkillContext,
  skillIds: ReadonlyArray<string>,
  overlays: SkillOverlayMap | null,
): Array<ToolDefinition> =>
  resolveSkills(ctx, skillIds, overlays).map((skill) =>
    defineTool({
      description: skill.description,
      input: buildInputSchema(skill.inputSchema, skill.id),
      name: skill.id,
      // SAFETY: The skill contract restricts every output to JSON-compatible values.
      // oxlint-disable-next-line no-unsafe-type-assertion
      run: async ({ data }) => ({ output: (await skill.execute(data)) as JsonValue }),
    }),
  );

export { buildFlueTools, buildInputSchema };
