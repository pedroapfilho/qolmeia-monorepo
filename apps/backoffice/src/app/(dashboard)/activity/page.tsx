import { Card, CardContent } from "@repo/ui/components/card";
import { EmptyState } from "@repo/ui/components/empty-state";
import { PageHeader } from "@repo/ui/components/page-header";
import { Skeleton } from "@repo/ui/components/skeleton";
import { cn } from "@repo/ui/lib/utils";
import type { ActivityResponse } from "@repo/worker-api/contracts";
import { Activity } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";

import { ActivityList } from "@/components/activity-list";
import { apiGetServer } from "@/lib/api-server";

export const metadata: Metadata = { title: "Atividade" };

/** @public Next.js app-router reads the instant segment config via the module loader */
export const instant = true;

const CATEGORIES = ["ACTION", "TICKET", "WORKER", "TEAM", "MEMBER"] as const;

type Category = (typeof CATEGORIES)[number];

const FilterChips = ({ active }: { active?: Category }) => (
  <nav aria-label="Filtrar por categoria" className="flex flex-wrap gap-2">
    <Link
      aria-current={active === undefined ? "page" : undefined}
      className={cn(
        "rounded-full px-3 py-1.5 text-xs font-semibold",
        active === undefined
          ? "bg-primary text-primary-foreground"
          : "border border-border bg-card text-muted-foreground",
      )}
      href="/activity"
    >
      Tudo
    </Link>
    {CATEGORIES.map((category) => (
      <Link
        aria-current={active === category ? "page" : undefined}
        className={cn(
          "rounded-full px-3 py-1.5 font-mono text-[11.5px] font-medium tracking-wide",
          active === category
            ? "bg-primary text-primary-foreground"
            : "border border-border bg-card text-muted-foreground",
        )}
        href={`/activity?category=${category}`}
        key={category}
      >
        {category}_*
      </Link>
    ))}
  </nav>
);

type ActivitySearchParams = Promise<Record<string, string | Array<string> | undefined>>;

const ActivityContent = async ({ searchParams }: { searchParams: ActivitySearchParams }) => {
  const params = await searchParams;
  const category = CATEGORIES.find((value) => value === params.category);
  const query = new URLSearchParams({ limit: "50" });
  if (category) {
    query.set("category", category);
  }
  const res = await apiGetServer<ActivityResponse>(`/activity?${query.toString()}`);

  return (
    <div className="flex flex-col gap-5">
      <PageHeader description="Registro completo do operador" title="Atividade" />

      <FilterChips active={category} />

      <Card>
        <CardContent className="px-0">
          {res.items.length === 0 ? (
            <EmptyState
              description={
                category
                  ? `Nenhum evento ${category}_* ainda.`
                  : "Quando os agentes começarem a trabalhar, os eventos aparecem aqui."
              }
              icon={<Activity aria-hidden />}
              title="Nenhum evento ainda"
            />
          ) : (
            <ActivityList
              category={category}
              initial={res.items}
              key={`${category ?? "all"}-${res.items[0]?.id ?? "empty"}`}
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
};

const ActivitySkeleton = () => (
  <div aria-hidden className="flex flex-col gap-5">
    <PageHeader description="Registro completo do operador" title="Atividade" />
    <Card>
      <CardContent className="flex flex-col gap-4">
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-12 w-full" />
      </CardContent>
    </Card>
  </div>
);

const ActivityPage = ({ searchParams }: { searchParams: ActivitySearchParams }) => (
  <Suspense fallback={<ActivitySkeleton />}>
    <ActivityContent searchParams={searchParams} />
  </Suspense>
);

export default ActivityPage;
