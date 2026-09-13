import type { McpToolResultDto } from './mcp.ts';

export type AuthorizationPolicyKind = 'local_admin' | 'client_grant';

export interface AuthorizationPolicy {
  readonly version: number;
  readonly kind: AuthorizationPolicyKind;
  readonly capabilities: readonly string[];
  readonly workspaces: readonly string[];
}

export interface PrincipalIdentity {
  readonly issuer?: string;
  readonly clientId?: string;
  readonly subject?: string;
  readonly tenant?: string;
  readonly organization?: string;
  readonly authorizationPolicy?: unknown;
  readonly authMode?: string;
  readonly resource?: string;
  readonly scopes?: readonly string[];
}

export type Principal = string | Readonly<PrincipalIdentity>;

// Successful authorization returns the normalized policy. Denials are exceptions.
export type AuthorizationResult = Readonly<AuthorizationPolicy>;

export interface ApprovalRequirement {
  readonly message: string;
}

export type ApprovalErrorCode =
  | 'APPROVAL_DECLINED'
  | 'APPROVAL_INTERACTION_UNAVAILABLE'
  | 'APPROVAL_GRANT_CONSUMED'
  | 'APPROVAL_GRANT_EXPIRED'
  | 'APPROVAL_TARGET_CHANGED'
  | 'APPROVAL_PRINCIPAL_MISMATCH';

export interface ApprovalFailurePayload extends Record<string, unknown> {
  readonly ok: false;
  readonly errorCode: ApprovalErrorCode;
  readonly error?: string;
  readonly cancelled?: boolean;
  readonly approvalRequired?: boolean;
  readonly operation?: string;
  readonly workspace?: string;
  readonly work_id?: string;
  readonly nextAction?: string;
}

// The native elicitation envelope is owned by the MCP SDK. Keep it opaque here;
// Rel.AI owns the requirement and structured failure payloads around it.
export interface NativeApprovalInputResult extends Record<string, unknown> {}

export type ApprovalResult =
  | null
  | McpToolResultDto<ApprovalFailurePayload>
  | NativeApprovalInputResult;
