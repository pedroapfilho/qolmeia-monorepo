import { fireEvent, render, screen } from "@testing-library/react";
import type React from "react";
import { describe, expect, it, vi } from "vitest";

// Stub Base-UI Button — its render path needs DOM features jsdom doesn't model.
vi.mock("@repo/ui/components/button", () => ({
  Button: ({
    children,
    ...props
  }: React.ButtonHTMLAttributes<HTMLButtonElement> & { children?: React.ReactNode }) => (
    // eslint-disable-next-line react/button-has-type -- pass-through stub for testing
    <button {...props}>{children}</button>
  ),
}));

const { SchemaForm } = await import("./schema-form");

describe("SchemaForm", () => {
  it("renders a string field and submits the edited value", async () => {
    const handleSubmit = vi.fn().mockResolvedValue(undefined);

    render(
      <SchemaForm
        initialValue={{ tone: "warm" }}
        onCancel={() => {}}
        onSubmit={handleSubmit}
        schema={{
          properties: { tone: { title: "Tom", type: "string" } },
          required: ["tone"],
          type: "object",
        }}
      />,
    );

    const input = screen.getByLabelText("Tom *") as HTMLInputElement;
    expect(input.value).toBe("warm");
    fireEvent.change(input, { target: { value: "bold" } });

    fireEvent.click(screen.getByRole("button", { name: "Salvar edição" }));

    await vi.waitFor(() => {
      expect(handleSubmit).toHaveBeenCalledWith({ tone: "bold" });
    });
  });

  it("renders a select for string enums", async () => {
    const handleSubmit = vi.fn().mockResolvedValue(undefined);

    render(
      <SchemaForm
        initialValue={{ size: "small" }}
        onCancel={() => {}}
        onSubmit={handleSubmit}
        schema={{
          properties: {
            size: { enum: ["small", "medium", "large"], title: "Tamanho", type: "string" },
          },
          required: ["size"],
          type: "object",
        }}
      />,
    );

    const select = screen.getByLabelText("Tamanho *") as HTMLSelectElement;
    expect(select.value).toBe("small");
    fireEvent.change(select, { target: { value: "large" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar edição" }));

    await vi.waitFor(() => {
      expect(handleSubmit).toHaveBeenCalledWith({ size: "large" });
    });
  });

  it("renders a textarea when maxLength exceeds 200", () => {
    render(
      <SchemaForm
        initialValue={{ body: "" }}
        onCancel={() => {}}
        onSubmit={vi.fn()}
        schema={{
          properties: { body: { maxLength: 2000, title: "Corpo", type: "string" } },
          type: "object",
        }}
      />,
    );

    const field = screen.getByLabelText("Corpo");
    expect(field.tagName).toBe("TEXTAREA");
  });

  it("coerces numbers and submits typed values", async () => {
    const handleSubmit = vi.fn().mockResolvedValue(undefined);

    render(
      <SchemaForm
        initialValue={{ count: 1 }}
        onCancel={() => {}}
        onSubmit={handleSubmit}
        schema={{
          properties: { count: { minimum: 0, title: "Quantidade", type: "integer" } },
          type: "object",
        }}
      />,
    );

    const input = screen.getByLabelText("Quantidade") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "7" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar edição" }));

    await vi.waitFor(() => {
      expect(handleSubmit).toHaveBeenCalledWith({ count: 7 });
    });
  });

  it("toggles boolean checkboxes", async () => {
    const handleSubmit = vi.fn().mockResolvedValue(undefined);

    render(
      <SchemaForm
        initialValue={{ optIn: false }}
        onCancel={() => {}}
        onSubmit={handleSubmit}
        schema={{
          properties: { optIn: { title: "Aceitar", type: "boolean" } },
          type: "object",
        }}
      />,
    );

    const checkbox = screen.getByLabelText("Aceitar") as HTMLInputElement;
    fireEvent.click(checkbox);
    fireEvent.click(screen.getByRole("button", { name: "Salvar edição" }));

    await vi.waitFor(() => {
      expect(handleSubmit).toHaveBeenCalledWith({ optIn: true });
    });
  });

  it("renders an array of strings with add/remove controls", async () => {
    const handleSubmit = vi.fn().mockResolvedValue(undefined);

    render(
      <SchemaForm
        initialValue={{ tags: ["a"] }}
        onCancel={() => {}}
        onSubmit={handleSubmit}
        schema={{
          properties: {
            tags: {
              items: { type: "string" },
              title: "Tags",
              type: "array",
            },
          },
          type: "object",
        }}
      />,
    );

    const addButton = screen.getByRole("button", { name: /adicionar/iv });
    fireEvent.click(addButton);

    // After click the second input exists.
    const inputs = screen.getAllByRole("textbox") as Array<HTMLInputElement>;
    expect(inputs).toHaveLength(2);
    fireEvent.change(inputs[1]!, { target: { value: "b" } });
    fireEvent.click(screen.getByRole("button", { name: "Salvar edição" }));

    await vi.waitFor(() => {
      expect(handleSubmit).toHaveBeenCalledWith({ tags: ["a", "b"] });
    });
  });

  it("calls onCancel when the cancel button is clicked", () => {
    const handleCancel = vi.fn();
    render(
      <SchemaForm
        initialValue={{}}
        onCancel={handleCancel}
        onSubmit={vi.fn()}
        schema={{ properties: {}, type: "object" }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Cancelar" }));
    expect(handleCancel).toHaveBeenCalledOnce();
  });

  it("falls back to a JSON textarea for unsupported shapes", () => {
    render(
      <SchemaForm
        initialValue={{ value: 1 }}
        onCancel={() => {}}
        onSubmit={vi.fn()}
        // oneOf is intentionally unhandled — see TODO in schema-form.tsx.
        schema={{ oneOf: [{ type: "string" }, { type: "number" }] }}
      />,
    );

    // JSON fallback exposes a textarea with serialised initial value.
    const textarea = screen.getByRole("textbox") as HTMLTextAreaElement;
    expect(textarea.value).toContain('"value"');
  });
});
