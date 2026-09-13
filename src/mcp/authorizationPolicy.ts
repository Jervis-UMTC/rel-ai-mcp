import type { AuthorizationPolicyKind, Principal } from '../contracts/authorization.ts';
import { getOperationCapability } from '../tools/actionCatalog.js';
import { AUTHORIZATION_CAPABILITY } from '../tools/contracts.ts';
import { AUTHORIZATION_POLICY_KIND, PRINCIPAL_KIND } from './contracts.ts';
import { principalKind } from './principal.ts';

const AUTHORIZATION_POLICY_VERSION = 1 as const;
const CAPABILITIES = AUTHORIZATION_CAPABILITY;
type AuthorizationCapability = typeof CAPABILITIES[keyof typeof CAPABILITIES];
type TypedAuthorizationPolicy = Readonly<{
  version: typeof AUTHORIZATION_POLICY_VERSION;
  kind: AuthorizationPolicyKind;
  capabilities: readonly AuthorizationCapability[];
  workspaces: readonly string[];
}>;
type AuthorizationCheckOptions = Readonly<{
  principal?: unknown;
  operationName?: unknown;
  workspace?: unknown;
}>;
type ConsentPolicyOptions = Readonly<{
  availableWorkspaces?: readonly string[];
  capabilities?: readonly AuthorizationCapability[];
  workspaces?: readonly string[];
}>;
type AuthorizationDeniedDetails = Readonly<Record<string, unknown>>;

type AuthorizationPolicyInput = Readonly<{
  version?: unknown;
  kind?: unknown;
  capabilities?: unknown;
  workspaces?: unknown;
}>;

const ALL_CAPABILITIES = Object.freeze(Object.values(CAPABILITIES)) as readonly AuthorizationCapability[];

class AuthorizationDeniedError extends Error {
  readonly code = 'AUTHORIZATION_DENIED' as const;
  readonly retryable = false;
  readonly details: AuthorizationDeniedDetails;

  constructor(message: string, details: AuthorizationDeniedDetails = {}) {
    super(message);
    this.name = 'AuthorizationDeniedError';
    this.details = details;
  }
}

function createLocalAdminPolicy(): TypedAuthorizationPolicy {
  return Object.freeze({
    version: AUTHORIZATION_POLICY_VERSION,
    kind: AUTHORIZATION_POLICY_KIND.LOCAL_ADMIN,
    capabilities: [...ALL_CAPABILITIES],
    workspaces: ['*']
  });
}

function createConsentPolicy(options: ConsentPolicyOptions = {}): TypedAuthorizationPolicy {
  const available = new Set((options.availableWorkspaces || []).map(cleanWorkspace).filter(Boolean));
  const capabilities = unique(options.capabilities).filter(isAuthorizationCapability);
  const workspaces = unique(options.workspaces)
    .map(cleanWorkspace)
    .filter(value => value === '*' || available.size === 0 || available.has(value));
  if (capabilities.length === 0) {
    throw new AuthorizationDeniedError('Select at least one Rel.AI capability.', { reason: 'capability_required' });
  }
  if (workspaces.length === 0) {
    throw new AuthorizationDeniedError('Select at least one configured workspace.', { reason: 'workspace_required' });
  }
  return Object.freeze({
    version: AUTHORIZATION_POLICY_VERSION,
    kind: AUTHORIZATION_POLICY_KIND.CLIENT_GRANT,
    capabilities: capabilities.sort(),
    workspaces: workspaces.sort()
  });
}

function normalizeAuthorizationPolicy(value: unknown): TypedAuthorizationPolicy {
  if (!isRecord(value)) throw new TypeError('Authorization policy must be an object.');
  const input = value as AuthorizationPolicyInput;
  if (Number(input.version) !== AUTHORIZATION_POLICY_VERSION) throw new TypeError('Unsupported authorization policy version.');
  if (!isAuthorizationPolicyKind(input.kind)) throw new TypeError('Unsupported authorization policy kind.');
  const capabilities = unique(input.capabilities).filter(isAuthorizationCapability);
  const workspaces = unique(input.workspaces).map(cleanWorkspace).filter(Boolean);
  if (capabilities.length === 0 || workspaces.length === 0) throw new TypeError('Authorization policy is incomplete.');
  return Object.freeze({
    version: AUTHORIZATION_POLICY_VERSION,
    kind: input.kind,
    capabilities: capabilities.sort(),
    workspaces: workspaces.sort()
  });
}

function requiredCapability(operationName: string): AuthorizationCapability | '' {
  const capability = getOperationCapability(operationName);
  if (!capability) return '';
  if (!isAuthorizationCapability(capability)) {
    throw new TypeError(`Operation '${operationName}' has an unsupported authorization capability.`);
  }
  return capability;
}

function authorizedWorkspaceAliases(principal: unknown, aliases: readonly string[] = []): string[] {
  const available = unique(aliases).map(cleanWorkspace).filter(Boolean);
  const kind = principalKind(principal);
  if (kind === PRINCIPAL_KIND.LOCAL_TRUSTED || kind === PRINCIPAL_KIND.STDIO_SESSION) return available;
  const policyValue = principalAuthorizationPolicy(principal);
  let policy: TypedAuthorizationPolicy;
  try {
    policy = normalizeAuthorizationPolicy(policyValue);
  } catch {
    return [];
  }
  if (policy.workspaces.includes('*')) return available;
  const allowed = new Set(policy.workspaces);
  return available.filter(alias => allowed.has(alias));
}

function assertAuthorizedToolCall(options: AuthorizationCheckOptions = {}): TypedAuthorizationPolicy {
  const principal = options.principal;
  const kind = principalKind(principal);
  if (kind === PRINCIPAL_KIND.LOCAL_TRUSTED || kind === PRINCIPAL_KIND.STDIO_SESSION) return createLocalAdminPolicy();
  if (kind === PRINCIPAL_KIND.MISSING || kind === PRINCIPAL_KIND.CONNECTOR_ANONYMOUS) {
    throw denied(options, 'Authenticated client authorization is required.');
  }
  let policy: TypedAuthorizationPolicy;
  try {
    policy = normalizeAuthorizationPolicy(principalAuthorizationPolicy(principal));
  } catch {
    throw denied(options, 'The authenticated client has no valid Rel.AI authorization grant.');
  }
  const operationName = String(options.operationName || '');
  const capability = requiredCapability(operationName);
  if (!capability) {
    throw denied(options, 'The requested operation is not classified by the authorization policy.', {
      reason: 'unclassified_operation'
    });
  }
  if (!policy.capabilities.includes(capability)) {
    throw denied(options, `The client grant does not permit ${capability}.`, { capability });
  }
  const workspace = cleanWorkspace(options.workspace);
  if (workspace && !policy.workspaces.includes('*') && !policy.workspaces.includes(workspace)) {
    throw denied(options, `The client grant does not permit workspace '${workspace}'.`, { workspace });
  }
  return policy;
}

function isTrustedLocalPrincipal(principal: unknown): principal is Principal {
  return principalKind(principal) === PRINCIPAL_KIND.STDIO_SESSION;
}

function principalAuthorizationPolicy(principal: unknown): unknown {
  return isRecord(principal) ? principal.authorizationPolicy : null;
}

function denied(
  options: AuthorizationCheckOptions,
  message: string,
  details: AuthorizationDeniedDetails = {}
): AuthorizationDeniedError {
  return new AuthorizationDeniedError(message, {
    operation: String(options.operationName || ''),
    workspace: cleanWorkspace(options.workspace),
    ...details
  });
}

function isAuthorizationCapability(value: string): value is AuthorizationCapability {
  return (ALL_CAPABILITIES as readonly string[]).includes(value);
}

function isAuthorizationPolicyKind(value: unknown): value is AuthorizationPolicyKind {
  return value === AUTHORIZATION_POLICY_KIND.LOCAL_ADMIN || value === AUTHORIZATION_POLICY_KIND.CLIENT_GRANT;
}

function unique(value: unknown): string[] {
  const values = Array.isArray(value) ? value : value == null ? [] : [value];
  return [...new Set(values.map(item => String(item || '').trim()).filter(Boolean))];
}

function cleanWorkspace(value: unknown): string {
  return String(value || '').trim().slice(0, 200);
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

export {
  CAPABILITIES,
  assertAuthorizedToolCall,
  authorizedWorkspaceAliases,
  createConsentPolicy,
  createLocalAdminPolicy,
  isTrustedLocalPrincipal,
  requiredCapability
};
