"use client";

import { useEffect, useRef } from "react";
import { useQueryClient, type QueryKey } from "@tanstack/react-query";

type Shared = { es: EventSource; listeners: Set<() => void> };
const shared = new Map<string, Shared>();

function subscribe(url: string, listener: () => void): () => void {
  let entry = shared.get(url);
  if (!entry) {
    const es = new EventSource(url);
    const listeners = new Set<() => void>();
    es.onmessage = () => listeners.forEach((l) => l());
    entry = { es, listeners };
    shared.set(url, entry);
  }
  entry.listeners.add(listener);
  const current = entry;
  return () => {
    current.listeners.delete(listener);
    if (!current.listeners.size) {
      current.es.close();
      shared.delete(url);
    }
  };
}

export function useLive(url: string | null, onChange: () => void) {
  const latest = useRef(onChange);
  latest.current = onChange;
  useEffect(() => {
    if (!url || typeof EventSource === "undefined") return;
    return subscribe(url, () => latest.current());
  }, [url]);
}

export function useLiveInvalidate(url: string | null, queryKey: QueryKey, exact = true) {
  const queryClient = useQueryClient();
  useLive(url, () => {
    queryClient.invalidateQueries({ queryKey, exact });
  });
}
