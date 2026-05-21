"use client";

import { Button } from "@repo/ui/components/button";
import { toast } from "@repo/ui/components/sonner";
import { useState } from "react";

import { ActivityRow } from "@/components/activity-row";
import { ApiError, apiGet } from "@/lib/api-client";
import type { ActivityRow as ActivityRowType, Paginated } from "@/lib/api-types";

type ActivityListProps = {
  initial: ReadonlyArray<ActivityRowType>;
  initialNextCursor: string | null;
  pageSize?: number;
};

const ActivityList = ({ initial, initialNextCursor, pageSize = 50 }: ActivityListProps) => {
  const [rows, setRows] = useState<ReadonlyArray<ActivityRowType>>(initial);
  const [cursor, setCursor] = useState<string | null>(initialNextCursor);
  const [loading, setLoading] = useState(false);

  const handleLoadMore = async () => {
    if (!cursor || loading) {
      return;
    }
    setLoading(true);
    try {
      const params = new URLSearchParams({
        cursor,
        limit: String(pageSize),
      });
      const next = await apiGet<Paginated<ActivityRowType>>(`/activity?${params.toString()}`);
      setRows((prev) => [...prev, ...next.items]);
      setCursor(next.nextCursor);
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
      {cursor && (
        <div className="flex justify-center pt-4">
          <Button disabled={loading} onClick={handleLoadMore} type="button" variant="outline">
            {loading ? "Carregando..." : "Carregar mais"}
          </Button>
        </div>
      )}
    </>
  );
};

export { ActivityList };
