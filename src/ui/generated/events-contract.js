// Generated from src/contracts/events.ts. Do not edit by hand.
export const DASHBOARD_LIVE_EVENTS = Object.freeze({
  "TASK_UPDATED": "task.updated",
  "CONNECTION_UPDATED": "connection.updated",
  "WORKSPACE_UPDATED": "workspace.updated",
  "PROCESS_UPDATED": "process.updated",
  "DIAGNOSTICS_UPDATED": "diagnostics.updated",
  "DASHBOARD_ERROR": "dashboard.error"
});

export const DASHBOARD_LIVE_EVENT_TYPES = Object.freeze([
  "task.updated",
  "connection.updated",
  "workspace.updated",
  "process.updated",
  "diagnostics.updated",
  "dashboard.error"
]);

export function createEmptyDashboardRevisions() {
  return {"task":0,"connection":0,"workspace":0,"process":0,"diagnostics":0};
}
