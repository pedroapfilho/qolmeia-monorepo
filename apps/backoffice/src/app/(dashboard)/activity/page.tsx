import { Card, CardContent } from "@repo/ui/components/card";
import type { Metadata } from "next";

import { ActivityList } from "@/components/activity-list";
import { apiGetServer } from "@/lib/api-server";
import type { ActivityRow, Paginated } from "@/lib/api-types";

export const metadata: Metadata = { title: "Atividade" };

const ActivityPage = async () => {
  const res = await apiGetServer<Paginated<ActivityRow>>("/activity?limit=50");

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold tracking-tight">Atividade</h1>
        <p className="text-sm text-muted-foreground">
          Linha do tempo unificada dos eventos da sua organização.
        </p>
      </header>

      <Card>
        <CardContent className="px-0">
          {res.items.length === 0 ? (
            <p className="px-6 py-10 text-center text-sm text-muted-foreground">
              Nenhum evento registrado ainda.
            </p>
          ) : (
            <ActivityList initial={res.items} initialNextCursor={res.nextCursor} />
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default ActivityPage;
