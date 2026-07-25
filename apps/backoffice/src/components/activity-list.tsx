"use client";

import { Button } from "@repo/ui/components/button";
import { toast } from "@repo/ui/lib/toast";
import { useState } from "react";

import { ActivityRow } from "@/components/activity-row";
import { apiGet, ApiError } from "@/lib/api-client";
import type { ActivityEntry, ActivityResponse } from "@/lib/api-types";

type ActivityListProps = {
  category?: string;
  initial: ReadonlyArray<ActivityEntry>;
  pageSize?: number;
};

const ActivityList = ({ category, initial, pageSize = 50 }: ActivityListProps) => {
  const [fetched, setFetched] = useState<ReadonlyArray<ActivityEntry>>([]);
  const [fetchExhausted, setFetchExhausted] = useState(false);
  const [loading, setLoading] = useState(false);

  const seen = new Set(initial.map((item) => item.id));
  const rows = [...initial, ...fetched.filter((item) => !seen.has(item.id))];
  const exhausted = fetchExhausted || initial.length < pageSize;

  const handleLoadMore = async () => {
    if (exhausted || loading) {
      return;
    }
    setLoading(true);
    try {
      const earliest = rows.at(-1)?.createdAt;
      const params = new URLSearchParams({ limit: String(pageSize) });
      if (earliest !== undefined) {
        params.set("before", String(earliest));
      }
      if (category !== undefined && category !== "") {
        params.set("category", category);
      }
      const next = await apiGet<ActivityResponse>(`/activity?${params.toString()}`);
      const fresh = next.items.filter((item) => !rows.some((existing) => existing.id === item.id));
      setFetched((prev) => [...prev, ...fresh]);
      if (fresh.length < pageSize) {
        setFetchExhausted(true);
      }
    } catch (error) {
      const message =
        error instanceof ApiError
          ? `Erro ${error.status}`
          : "Não foi possível carregar mais eventos.";
      toast.error(message);
    }
    setLoading(false);
  };

  return (
    <>
      <ul className="flex flex-col">
        {rows.map((row) => (
          <ActivityRow key={row.id} row={row} />
        ))}
      </ul>
      {!exhausted && (
        <div className="flex justify-center px-5 pt-4 pb-2">
          <Button
            disabled={loading}
            onClick={() => {
              void handleLoadMore();
            }}
            type="button"
            variant="outline"
          >
            {loading ? "Carregando…" : "Carregar mais"}
          </Button>
        </div>
      )}
    </>
  );
};

export { ActivityList };
