import { createServer } from "node:http";

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
