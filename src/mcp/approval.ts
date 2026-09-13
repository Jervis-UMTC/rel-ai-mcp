import type { ApprovalRequirement, ApprovalResult } from '../contracts/authorization.ts';
import { catalogApprovalRequirement } from '../tools/actionCatalog.js';
import {
  approvalDigest,
  requestApproval,
  type ApprovalArguments,
  type ApprovalContext,
  type ApprovalRawContext,
  type ApprovalStateCodec
} from './approvalBroker.ts';

async function requireApprovalIfNeeded(
  name: string,
  args: ApprovalArguments,
  context: ApprovalContext,
  rawContext: ApprovalRawContext,
  codec: ApprovalStateCodec
): Promise<ApprovalResult> {
  const requirement = approvalRequirement(name, args);
  if (!requirement) return null;
  return requestApproval({
    name,
    args,
    requirement,
    context,
    rawContext,
    codec
  });
}

function approvalRequirement(name: string, args: ApprovalArguments = {}): ApprovalRequirement | null {
  return catalogApprovalRequirement(name, args) as ApprovalRequirement | null;
}

export { approvalDigest, approvalRequirement, requireApprovalIfNeeded };
