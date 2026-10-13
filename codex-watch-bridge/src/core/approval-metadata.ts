import type { ApprovalEntry, ApprovalRisk } from '../types.js';

export interface ApprovalMetadata {
  action?: string;
  targetPath?: string;
  affectedFiles?: string[];
  commandPreview?: string;
  reasons?: string[];
  reversible?: boolean;
  requiresStrongConfirm?: boolean;
  metadata?: Record<string, unknown>;
}

const HIGH_RISK_HINTS = [
  'sudo', 'remove-item', 'rm -rf', 'rd /s', 'rmdir /s', 'format ',
  'drop ', 'delete from ', 'danger-full-access', 'credential', 'secret',
  'private key', 'payment', 'billing', 'publish', 'deploy --force',
];
const MEDIUM_RISK_HINTS = [
  'npm install', 'pnpm install', 'yarn add', 'pip install', 'gradle ',
  'git push', 'network', 'workspace-write', 'invoke-webrequest', 'curl ',
];
const DELETE_HINTS = ['delete', 'remove', 'rm ', 'unlink', 'erase', 'format'];
const DEPLOY_HINTS = ['deploy', 'publish', 'release', 'upload', 'push'];

function asStringArray(value: unknown, limit = 8): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const values = value
    .filter((v): v is string => typeof v === 'string' || typeof v === 'number')
    .map((v) => String(v).trim())
    .filter(Boolean)
    .slice(0, limit);
  return values.length > 0 ? values : undefined;
}

function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  }
  return undefined;
}

function commandPreview(payload: any): string | undefined {
  const command = payload?.command ?? payload?.argv ?? payload?.cmd;
  if (Array.isArray(command)) {
    return command.map((part) => typeof part === 'string' ? part : JSON.stringify(part)).join(' ').slice(0, 400);
  }
  if (typeof command === 'string') return command.slice(0, 400);
  return firstString(payload?.command_preview, payload?.commandPreview)?.slice(0, 400);
}

function pathsFrom(payload: any): { target?: string; files?: string[] } {
  const target = firstString(payload?.cwd, payload?.working_directory, payload?.target, payload?.path);
  const files = asStringArray(
    payload?.files ?? payload?.paths ?? payload?.affected_files ?? payload?.affectedFiles,
  )?.map((file) => file.replace(/^\.?[\\/]/, ''));
  return { target, files: files?.length ? files : undefined };
}

function reasonsFor(risk: ApprovalRisk, text: string, files?: string[]): string[] {
  const reasons: string[] = [];
  const lower = text.toLowerCase();
  if (DELETE_HINTS.some((hint) => lower.includes(hint))) reasons.push('包含删除或不可逆写操作');
  if (DEPLOY_HINTS.some((hint) => lower.includes(hint))) reasons.push('会影响外部环境或发布产物');
  if (lower.includes('sudo')) reasons.push('请求提升权限');
  if (lower.includes('secret') || lower.includes('credential') || lower.includes('private key')) reasons.push('可能访问敏感凭据');
  if (lower.includes('install')) reasons.push('会安装或修改依赖');
  if (lower.includes('network') || lower.includes('curl ') || lower.includes('invoke-webrequest')) reasons.push('会访问网络');
  if (risk === 'high' && reasons.length === 0) reasons.push('操作影响范围较大');
  if (risk === 'medium' && reasons.length === 0) reasons.push('会写入工作区或访问外部资源');
  if ((files?.length ?? 0) > 3) reasons.push(`影响 ${files!.length} 个文件`);
  return Array.from(new Set(reasons)).slice(0, 4);
}

function reversibleFor(text: string): boolean | undefined {
  const lower = text.toLowerCase();
  if (DELETE_HINTS.some((hint) => lower.includes(hint)) || lower.includes('format ')) return false;
  if (lower.includes('read') || lower.includes('list') || lower.includes('status')) return true;
  return undefined;
}

export function extractApprovalMetadata(
  payload: any,
  risk: ApprovalRisk,
  fallbackDetail = '',
): ApprovalMetadata {
  const derivedCommandPreview = commandPreview(payload);
  const { target, files } = pathsFrom(payload);
  const action = firstString(
    payload?.item?.type,
    payload?.item_type,
    payload?.kind,
    payload?.action,
    payload?.tool,
    payload?.type,
  );
  const rawMetadata = payload?.metadata;
  const metadata = rawMetadata && typeof rawMetadata === 'object' && !Array.isArray(rawMetadata)
    ? rawMetadata as Record<string, unknown>
    : undefined;

  const scanText = [fallbackDetail, derivedCommandPreview, target, ...(files ?? [])]
    .filter(Boolean)
    .join('\n');
  const reasons = reasonsFor(risk, scanText || JSON.stringify(payload ?? {}), files);
  const requiresStrongConfirm = risk === 'high' ||
    /danger-full-access|sudo|rm -rf|remove-item .*-recurse|format |drop |delete from/.test(scanText.toLowerCase());

  return {
    action: action?.slice(0, 80),
    targetPath: target?.slice(0, 300),
    affectedFiles: files,
    commandPreview: derivedCommandPreview,
    reasons: reasons.length > 0 ? reasons : undefined,
    reversible: reversibleFor(scanText),
    requiresStrongConfirm,
    metadata,
  };
}

export function approvalWithMetadata(
  approval: Omit<ApprovalEntry, keyof ApprovalMetadata | 'metadata'> & Partial<ApprovalMetadata>,
  payload?: any,
): ApprovalEntry {
  const derived = extractApprovalMetadata(payload, approval.risk, approval.detail);
  const requiresStrongConfirm = approval.requiresStrongConfirm ??
    derived.requiresStrongConfirm ??
    approval.risk === 'high';

  return {
    ...approval,
    ...derived,
    requiresStrongConfirm,
  };
}
