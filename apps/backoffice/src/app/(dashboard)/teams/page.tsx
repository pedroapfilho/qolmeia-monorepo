import { Card, CardContent, CardHeader, CardTitle } from "@repo/ui/components/card";
import { headers } from "next/headers";
import Link from "next/link";

import { requireStaff } from "@/lib/auth-helpers";
import { fetchTeam } from "@/lib/team-fetch";

const TeamsPage = async () => {
  const session = await requireStaff();
  const headersList = await headers();
  const cookie = headersList.get("cookie") ?? "";
  const companyId = session.currentOrg?.id ?? "";
  const members = await fetchTeam(companyId, cookie);

  return (
    <div className="flex flex-col gap-4">
      <header>
        <h1 className="text-2xl font-semibold">Times</h1>
        <p className="text-sm text-muted-foreground">{members.length} agente(s) nesta empresa</p>
      </header>
      <div className="grid gap-3 md:grid-cols-2">
        {members.map((m) => (
          <Card key={m.id}>
            <CardHeader>
              <CardTitle className="text-base">
                <Link className="hover:underline" href={`/teams/${companyId}/members/${m.id}`}>
                  {m.displayName}
                </Link>
              </CardTitle>
            </CardHeader>
            <CardContent className="flex items-center justify-between text-sm">
              <span>{m.role === "worker" ? m.workerKind : m.role}</span>
              <span>{m.status}</span>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
};

export default TeamsPage;
