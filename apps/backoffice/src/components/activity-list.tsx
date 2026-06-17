"use client";

import { Button } from "@repo/ui/components/button";
import { toast } from "@repo/ui/lib/toast";
import { useState } from "react";

import { ActivityRow } from "@/components/activity-row";
import { apiGet, ApiError } from "@/lib/api-client";
import type { ActivityEntry, ActivityResponse } from "@/lib/api-types";

type ActivityListProps = {
  initial: ReadonlyArray<ActivityEntry>;
  pageSize?: number;
};

// Time-based pagination: ask for entries strictly older than the last one
// we have. The agents Worker returns descending by createdAt, so the tail
// is the oldest; we paginate by `since=earliest-1`. Once a page comes back
// empty we hide the button.
const ActivityList = ({ initial, pageSize = 50 }: ActivityListProps) => {
  const [rows, setRows] = useState<ReadonlyArray<ActivityEntry>>(initial);
  const [exhausted, setExhausted] = useState(initial.length < pageSize);
  const [loading, setLoading] = useState(false);

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
      const next = await apiGet<ActivityResponse>(`/activity?${params.toString()}`);
      const fresh = next.items.filter((item) => !rows.some((existing) => existing.id === item.id));
      setRows((prev) => [...prev, ...fresh]);
      if (fresh.length < pageSize) {
        setExhausted(true);
      }
    } catch (error) {
      const message =
        error instanceof ApiError
          ? `Erro ${error.status}`
          : "Não foi possível carregar mais eventos.";
      toast.error(message);
    } finally {
      setLoading(false);
    }
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
          <Button disabled={loading} onClick={handleLoadMore} type="button" variant="outline">
            {loading ? "Carregando…" : "Carregar mais"}
          </Button>
        </div>
      )}
    </>
  );
};

export { ActivityList };
