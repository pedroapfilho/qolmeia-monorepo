import { describe, expect, it, vi } from "vitest";

import { buildAuthRoutes } from "./auth";

const handlerMock = vi.fn<(request: Request) => Promise<Response>>();
const authRoutes = buildAuthRoutes(handlerMock);

describe("authRoutes adapter", () => {
  it("forwards /api/auth/* requests to auth.handler unchanged", async () => {
    const responseBody = JSON.stringify({ ok: true });
    handlerMock.mockResolvedValueOnce(
      new Response(responseBody, {
        headers: {
          "Content-Type": "application/json",
          "Set-Cookie": "qolmeia.session=opaque; Path=/; HttpOnly",
        },
        status: 200,
      }),
    );

    const req = new Request("http://localhost:4000/auth/sign-in/email", {
      body: JSON.stringify({ email: "u@example.com", password: "twelvecharsmin" }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    });
    const res = await authRoutes.fetch(req);

    expect(handlerMock).toHaveBeenCalledTimes(1);
    const forwarded = handlerMock.mock.calls[0][0];
    expect(forwarded.url).toBe("http://localhost:4000/auth/sign-in/email");
    expect(forwarded.method).toBe("POST");
    expect(res.status).toBe(200);
    expect(res.headers.get("Set-Cookie")).toContain("qolmeia.session=");
    expect(await res.json()).toEqual({ ok: true });
  });
});
