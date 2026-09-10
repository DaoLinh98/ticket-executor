"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { CONNECTION_CHANGED_EVENT, type ConnectionChangedDetail } from "./connectionEvents";

/**
 * What each page was last looking at — its project, sprint, view and filters —
 * remembered in the browser so moving between pages resumes the work in
 * progress instead of resetting to the first project and the current iteration.
 *
 * Scoped by organization, not globally. One connection's project list has
 * nothing in common with another's, so a single remembered "project" would be
 * restored into an organization that has no such project and fail the load. The
 * scope key is the active connection id, which arrives on
 * `CONNECTION_CHANGED_EVENT` and is mirrored to `localStorage` by
 * `ProviderBadge` so a fresh page load knows it before any fetch resolves.
 *
 * This is a convenience, never a source of truth: a remembered value that no
 * longer exists at the provider must be discarded by the page that restores it
 * (see the `includes(...)` guards in the callers), and every page must still
 * work with the store empty.
 */

const STORE_KEY = "te.pagePrefs";
/** Written by ProviderBadge; read here to scope the store before the first fetch. */
export const ACTIVE_CONNECTION_KEY = "te.activeConnection";

/** scope (connection id) → page → key → value */
type Store = Record<string, Record<string, Record<string, unknown>>>;

type PrefValue = string | number | boolean;

function readStore(): Store {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    const parsed = raw ? JSON.parse(raw) : null;
    return parsed && typeof parsed === "object" ? (parsed as Store) : {};
  } catch {
    return {};
  }
}

function currentScope(): string {
  try {
    return localStorage.getItem(ACTIVE_CONNECTION_KEY) || "default";
  } catch {
    return "default";
  }
}

/** Mirror the active connection id, so the next page load scopes to it. */
export function rememberActiveConnection(id: string) {
  try {
    if (id) localStorage.setItem(ACTIVE_CONNECTION_KEY, id);
  } catch {
    /* private mode — prefs simply do not persist */
  }
}

/**
 * A page's remembered controls.
 *
 * `ready` is false until the store has been read, and it is false on purpose:
 * `localStorage` is not available while the page is server-rendered, so reading
 * it during the first render would either throw or hydrate a different value
 * than the server sent. Callers gate their initial load on `ready` — otherwise
 * the page fetches the default project first and the remembered one a moment
 * later, which is the double load this whole mechanism exists to remove.
 */
export function usePagePrefs<T extends Record<string, PrefValue>>(
  page: string,
  fallback: T
): { prefs: T; ready: boolean; save: (patch: Partial<T>) => void } {
  const [prefs, setPrefs] = useState<T>(fallback);
  const [ready, setReady] = useState(false);
  // The fallback is written inline by callers, so a new object identity arrives
  // on every render; the ref keeps the effects below from re-running on it.
  const fallbackRef = useRef(fallback);
  const scopeRef = useRef("default");
  // The current value, mirrored so `save` can merge without a state updater —
  // writing to localStorage inside one would be a side effect in the render
  // phase, which React is free to run twice.
  const prefsRef = useRef(prefs);
  prefsRef.current = prefs;

  const hydrate = useCallback((scope: string) => {
    scopeRef.current = scope;
    const stored = readStore()[scope]?.[page];
    const next = { ...fallbackRef.current, ...(stored as Partial<T> | undefined) };
    prefsRef.current = next;
    setPrefs(next);
    setReady(true);
  }, [page]);

  useEffect(() => { hydrate(currentScope()); }, [hydrate]);

  // A different organization is a different set of answers. Re-hydrating rather
  // than clearing is what makes switching back and forth free.
  useEffect(() => {
    const onChanged = (e: Event) => {
      const id = (e as CustomEvent<ConnectionChangedDetail>).detail?.connectionId || "default";
      rememberActiveConnection(id);
      setReady(false);
      hydrate(id);
    };
    window.addEventListener(CONNECTION_CHANGED_EVENT, onChanged);
    return () => window.removeEventListener(CONNECTION_CHANGED_EVENT, onChanged);
  }, [hydrate]);

  const save = useCallback((patch: Partial<T>) => {
    const next = { ...prefsRef.current, ...patch };
    prefsRef.current = next;
    setPrefs(next);
    try {
      const store = readStore();
      const scope = scopeRef.current;
      store[scope] = { ...store[scope], [page]: next };
      localStorage.setItem(STORE_KEY, JSON.stringify(store));
    } catch {
      /* private mode — the value still applies for this session */
    }
  }, [page]);

  return { prefs, ready, save };
}
