import { createServer } from "node:http";

// Minimal stand-in for the agents Worker's `/api/me`, used ONLY by the e2e
// webServer. The real Worker (Durable Objects + Workflows + D1 + KV) isn't
// started in CI, and the sign-up flow can't grant an org membership — so the
// staff-gated backoffice dashboard is otherwise unreachable and can't be
// exercised by a navigation test.
//
// It grants an OWNER membership ONLY when the request carries the
// `e2e-role=OWNER` marker cookie (set by soft-navigation.spec.ts). Every
// other spec sends no marker, so it keeps its non-staff default and the
// existing `/no-access` bounce that login.spec.ts pins.
const PORT = 8787;
const HOST = "127.0.0.1";

const staffMe = {
  currentOrg: { id: "e2e-org", name: "E2E Org", role: "OWNER", slug: "e2e-org" },
  role: "OWNER",
  user: {
    displayName: "E2E Staff",
    email: "e2e-test@qolmeia.localhost",
    id: "e2e-user",
    name: "E2E Staff",
  },
};

const server = createServer((req, res) => {
  const { pathname } = new URL(req.url ?? "/", `http://${HOST}:${PORT}`);

  if (pathname === "/healthz") {
    res.writeHead(200).end("ok");
    return;
  }

  if (pathname === "/api/me") {
    const isStaff = /(?:^|;\s*)e2e-role=OWNER(?:;|$)/v.test(req.headers.cookie ?? "");
    if (isStaff) {
      res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(staffMe));
      return;
    }
    res.writeHead(403).end();
    return;
  }

  // Backoffice endpoints: return an empty-but-valid payload so dashboard pages
  // render their empty states instead of throwing on a 404 (some pages don't
  // catch the fetch). Keyed by the array field each response type uses:
  // /companies → { companies: [] }, the rest → { items: [] }. Enough for
  // shell/navigation assertions.
  if (pathname.startsWith("/api/backoffice/")) {
    const body = pathname.startsWith("/api/backoffice/companies")
      ? { companies: [] }
      : { items: [] };
    res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(body));
    return;
  }

  res.writeHead(404).end();
});

server.listen(PORT, HOST, () => {
  process.stdout.write(`agents-stub listening on http://${HOST}:${PORT}\n`);
});
