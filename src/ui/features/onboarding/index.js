import { postJson } from '../../api.js';
import { routeMetadata } from '../../navigation-catalog.js';

const DISMISSED_KEY = 'relai_desktop_setup_dismissed';
let completionPersisted = false;
let pendingPersisted = false;

export function desktopSetupSteps({
  hasWorkspace = false,
  endpointReady = false,
  chatgptReady = false,
  firstRequestObserved = false
} = {}) {
  const requestUnlocked = hasWorkspace && endpointReady && chatgptReady;
  return [
    {
      id: 'connection',
      title: 'Connect this computer',
      description: 'In OpenAI Platform, copy the Secure MCP Tunnel ID and create a runtime API key. Save both values here.',
      href: routeMetadata('settings/connection').href,
      action: 'Set up connection',
      complete: endpointReady,
      locked: false
    },
    {
      id: 'chatgpt',
      title: 'Create the Rel.AI connector in ChatGPT',
      description: 'Open the ChatGPT Plugins + connector form. Use Tunnel + No authentication. Scan the Rel.AI tools.',
      action: 'Follow ChatGPT setup',
      actionType: 'guide',
      complete: endpointReady && chatgptReady,
      locked: !endpointReady
    },
    {
      id: 'workspace',
      title: 'Add a project',
      description: 'Choose a project folder and give it a short name.',
      href: routeMetadata('workspaces').href,
      action: hasWorkspace ? 'Project added' : 'Add project',
      complete: hasWorkspace,
      locked: false
    },
    {
      id: 'first-request',
      title: 'Send your first Rel.AI request',
      description: 'Open ChatGPT, select Rel.AI MCP, and send the request below to make sure ChatGPT can reach your project.',
      action: 'Copy first request',
      actionType: 'copy',
      complete: requestUnlocked && firstRequestObserved,
      locked: !requestUnlocked
    }
  ];
}

export function isDesktopSetupDismissed() {
  try { return localStorage.getItem(DISMISSED_KEY) === '1'; } catch { return false; }
}

export async function dismissDesktopSetup() {
  setDesktopSetupDismissed(true);
  announceDesktopSetupState(false);
  return persistDesktopSetup({ skipped: true, handoffPending: false, source: 'overview-checklist' });
}

export async function completeDesktopSetup() {
  setDesktopSetupDismissed(true);
  announceDesktopSetupState(false);
  if (completionPersisted) return null;
  completionPersisted = true;
  return persistDesktopSetup({ completed: true, handoffPending: false, source: 'overview-checklist' });
}

export function syncDesktopSetupState(status = {}) {
  const pending = status.needsOnboarding === true || status.handoffPending === true;
  setDesktopSetupDismissed(!pending);
  announceDesktopSetupState(pending);
  if (pending) persistPendingSetup();
  return pending;
}

function setDesktopSetupDismissed(value) {
  try {
    if (value) localStorage.setItem(DISMISSED_KEY, '1');
    else localStorage.removeItem(DISMISSED_KEY);
  } catch {}
}

function announceDesktopSetupState(pending) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent('relai:onboarding-state', { detail: { pending } }));
}

function persistPendingSetup() {
  if (pendingPersisted) return;
  pendingPersisted = true;
  void persistDesktopSetup({ completed: false, skipped: false, handoffPending: true, source: 'overview-checklist' })
    .then(result => { if (!result) pendingPersisted = false; });
}

async function persistDesktopSetup(payload) {
  try {
    return await postJson('/api/onboarding/complete', payload);
  } catch {
    return null;
  }
}
