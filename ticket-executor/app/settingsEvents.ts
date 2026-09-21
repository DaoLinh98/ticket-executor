// How a settings change reaches everything that reacts to it.
//
// Three hops, because a change has three distances to travel:
//   - the document that saved it        → a `window` CustomEvent, applied instantly
//   - another tab of the same browser   → a BroadcastChannel message, applied instantly
//   - another browser, another device   → nothing here; SettingsProvider re-reads
//                                         /api/settings on resume and on a timer
//
// Lives in its own module (not next to a listener) because both the root-layout
// SettingsProvider and the Settings page import it — importing the constant from
// either component would drag that component into the other's bundle.
export const SETTINGS_UPDATED_EVENT = "te:settings-updated";

const SETTINGS_CHANNEL = "te:settings";

export type SettingsUpdatedDetail = {
  animatedBackground?: boolean;
  clickEffects?: boolean;
  ringAnimation?: boolean;
};

/** Announce a save to this document and to every other tab of this browser. */
export function broadcastSettingsUpdated(detail: SettingsUpdatedDetail): void {
  window.dispatchEvent(new CustomEvent(SETTINGS_UPDATED_EVENT, { detail }));
  try {
    const channel = new BroadcastChannel(SETTINGS_CHANNEL);
    channel.postMessage(detail);
    channel.close();
  } catch {
    /* no BroadcastChannel (older Safari) — the other tabs pick the change up on
       their next resume/poll instead of instantly */
  }
}

/** Listen for both hops. Returns the unsubscribe. */
export function onSettingsUpdated(fn: (detail: SettingsUpdatedDetail) => void): () => void {
  const onEvent = (e: Event) => {
    const detail = (e as CustomEvent<SettingsUpdatedDetail>).detail;
    if (detail) fn(detail);
  };
  window.addEventListener(SETTINGS_UPDATED_EVENT, onEvent);

  let channel: BroadcastChannel | null = null;
  try {
    channel = new BroadcastChannel(SETTINGS_CHANNEL);
    channel.onmessage = (e) => { if (e.data) fn(e.data as SettingsUpdatedDetail); };
  } catch {
    /* see broadcastSettingsUpdated */
  }

  return () => {
    window.removeEventListener(SETTINGS_UPDATED_EVENT, onEvent);
    channel?.close();
  };
}
