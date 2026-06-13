import { Card, CardContent } from "@repo/ui/components/card";
import { EmptyState } from "@repo/ui/components/empty-state";
import { PageHeader } from "@repo/ui/components/page-header";
import { Activity } from "lucide-react";
import type { Metadata } from "next";

import { ActivityList } from "@/components/activity-list";
import { apiGetServer } from "@/lib/api-server";
import type { ActivityResponse } from "@/lib/api-types";

export const metadata: Metadata = { title: "Atividade" };

const ActivityPage = async () => {
  const res = await apiGetServer<ActivityResponse>("/activity?limit=50");

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        description="Linha do tempo unificada dos eventos da sua organização."
        title="Atividade"
      />

      <Card>
        <CardContent className="px-0">
          {res.items.length === 0 ? (
            <EmptyState
              description="Quando os agentes começarem a trabalhar, os eventos aparecem aqui."
              icon={<Activity aria-hidden />}
              title="Nenhum evento ainda"
            />
          ) : (
            /* ActivityList seeds local pagination state from `initial`; keying
               by the newest row remounts it when a router refresh brings fresh
               data, so the list never shows a stale first page. */
            <ActivityList initial={res.items} key={res.items[0]?.id ?? "empty"} />
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default ActivityPage;
