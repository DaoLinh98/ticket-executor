// Fired by the Settings page after a successful save so app-wide effects react
// immediately, without waiting for a route change / reload. `detail` carries the
// saved values the listeners care about.
//
// Lives in its own module (not next to a listener) because both the root-layout
// BoltsProvider and the (app)-group AppReactor listen for it — importing the
// constant from either component would drag that component into the other's
// bundle.
export const SETTINGS_UPDATED_EVENT = "te:settings-updated";

export type SettingsUpdatedDetail = {
  animatedBackground?: boolean;
  clickEffects?: boolean;
  ringAnimation?: boolean;
};
