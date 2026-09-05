// Fired when the active organization changes — the header picker switched it,
// or the Settings page added / removed / activated one. Every page that loads
// provider-backed data (projects, tickets, sprints, reviews, preflight,
// dashboard) listens and reloads, because the server now answers as a different
// organization.
//
// Lives in its own module for the same reason as SETTINGS_UPDATED_EVENT: the
// listeners are spread across route groups and must not import each other.
export const CONNECTION_CHANGED_EVENT = "te:connection-changed";

export type ConnectionChangedDetail = {
  provider: string;
  connectionId: string;
  org: string;
};
