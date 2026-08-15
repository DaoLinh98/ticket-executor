// Fired by the Settings page after a successful save so app-wide effects react
// immediately, without waiting for a route change / reload. `detail` carries the
// saved values the listeners care about.
//
// Lives in its own module (not next to a listener) because both the root-layout
// BoltsProvider and the (app)-group AppReactor listen for it — importing the
// constant from either component would drag that component into the other's
// bundle.
export const SETTINGS_UPDATED_EVENT = "te:settings-updated";

/** Where the last known theme is mirrored so the document can be painted in the
 *  right brand before the settings fetch resolves. The database stays the source
 *  of truth; this is a cache with exactly one job — no flash of the wrong theme. */
export const THEME_STORAGE_KEY = "te:theme";

export type SettingsUpdatedDetail = {
  animatedBackground?: boolean;
  emehubTheme?: boolean;
  clickEffects?: boolean;
};
