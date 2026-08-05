import { useFocusEffect } from "expo-router";
import { useCallback, useState } from "react";

import { mobileStore } from "../storage/mobile-store";

export const useMobileResource = <T>(key: string, load: () => Promise<T>) => {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const next = await load();
      setData(next);
      setError(null);
      await mobileStore.putDisplaySnapshot(key, next);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Could not refresh");
    } finally {
      setRefreshing(false);
    }
  }, [key, load]);

  useFocusEffect(
    useCallback(() => {
      let current = true;
      void mobileStore.getDisplaySnapshot<T>(key).then((cached) => {
        if (current && cached) setData(cached);
      });
      void refresh();
      return () => {
        current = false;
      };
    }, [key, refresh]),
  );
  return { data, error, refreshing, refresh };
};
