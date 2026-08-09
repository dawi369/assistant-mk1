import { useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";

import { useWorkbench } from "../workbench-provider";

export const useMobileResource = <T>(load: () => Promise<T>) => {
  const { resourceRevision } = useWorkbench();
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const next = await load();
      setData(next);
      setError(null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Could not refresh");
    } finally {
      setRefreshing(false);
    }
  }, [load]);

  useFocusEffect(
    useCallback(() => {
      void refresh();
      return undefined;
    }, [refresh, resourceRevision]),
  );
  return { data, error, refreshing, refresh };
};
