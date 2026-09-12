'use strict';
const { contextBridge } = require('electron');
const noListener = () => () => {};
contextBridge.exposeInMainWorld('relaiDesktop', {
  getWindowState: async () => ({ customTitleBar: true, controls: 'custom', platform: 'win32', maximized: false }),
  minimizeWindow: async () => ({ ok: true }),
  toggleMaximizeWindow: async () => ({ ok: true }),
  closeWindow: async () => ({ ok: true }),
  onWindowState: noListener,
  onStatus: noListener,
  getStatus: async () => null,
  getLocalUsage: async month => {
    const hour = new Date().toISOString().slice(0, 13);
    return {
      ok: true,
      source: 'local',
      month,
      totals: { requests: 2, toolCalls: 2, successes: 2, failures: 0, requestBytes: 0, resultBytes: 0, executionMs: 30, activeDays: 1 },
      tools: [{ tool: 'relai_edit', toolCalls: 1, successes: 1, failures: 0, executionMs: 12 }, { tool: 'relai_validate', toolCalls: 1, successes: 1, failures: 0, executionMs: 18 }],
      devices: [],
      workspaces: [{ workspace: 'app', toolCalls: 2, successes: 2, failures: 0, executionMs: 30 }],
      workspaceDimensions: [],
      workspaceTools: [],
      activityMatrix: [{ intent: 'bugfix', useCase: 'edit', toolCalls: 1, successes: 1, failures: 0, executionMs: 12 }, { intent: 'bugfix', useCase: 'validate', toolCalls: 1, successes: 1, failures: 0, executionMs: 18 }],
      workspaceActivityMatrix: [],
      taskIntents: [{ intent: 'bugfix', tasks: 1 }],
      workspaceTaskIntents: [],
      series: [{ hour, requests: 2, toolCalls: 2, successes: 2, failures: 0, executionMs: 30 }],
      toolSeries: [],
      workspaceSeries: [],
      workspaceToolSeries: [],
      activityMatrixSeries: [{ hour, intent: 'bugfix', useCase: 'edit', toolCalls: 1, successes: 1, failures: 0, executionMs: 12 }, { hour, intent: 'bugfix', useCase: 'validate', toolCalls: 1, successes: 1, failures: 0, executionMs: 18 }],
      workspaceActivityMatrixSeries: [],
      taskIntentSeries: [{ hour, intent: 'bugfix', tasks: 1 }],
      workspaceTaskIntentSeries: [],
      failureCategories: [],
      failureCategorySeries: []
    };
  }
});
