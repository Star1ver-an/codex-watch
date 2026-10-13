// Shared types for the watch bridge protocol and internal state.

export type ThreadPhase =
  | 'running'
  | 'waiting_approval'
  | 'idle'
  | 'aborted'
  | 'unknown';

export type ApprovalRisk = 'low' | 'medium' | 'high' | 'unknown';

export type ApprovalDecision = 'approve' | 'reject' | 'timeout';

export interface ApprovalEntry {
  id: string;
  title: string;
  detail: string;
  risk: ApprovalRisk;
  createdAtMs: number;
  source: 'rollout' | 'mcp' | 'demo';
}

export interface ThreadState {
  id: string;
  title: string;
  preview?: string;
  cwd?: string;
  model?: string;
  approvalPolicy?: string;
  tokensUsed?: number;
  lastActivityMs: number;
  phase: ThreadPhase;
  lastEvent?: string;
  pendingApprovals: ApprovalEntry[];
}

// ---- WebSocket protocol messages ----

export interface HelloMsg {
  type: 'hello';
  token: string;
  device?: string;
}

export interface SnapshotMsg {
  type: 'snapshot';
  threads: ThreadState[];
  serverTimeMs: number;
}

export interface ThreadUpdateMsg {
  type: 'thread_update';
  thread: ThreadState;
}

export interface ApprovalRequestMsg {
  type: 'approval_request';
  threadId: string;
  threadTitle: string;
  approval: ApprovalEntry;
}

export interface ApprovalResultMsg {
  type: 'approval_result';
  approvalId: string;
  decision: 'approve' | 'reject';
  note?: string;
}

export interface PairOkMsg {
  type: 'pair_ok';
  token: string;
  fingerprint: string;
}

export interface WelcomeMsg {
  type: 'welcome';
  server: string;
  protocol: 1;
}

export interface ErrorMsg {
  type: 'error';
  code: string;
  message: string;
}

// ---- MCP control channel (mcp.js <-> bridge) ----

export interface ApprovalRequestCreateMsg {
  type: 'approval_request_create';
  reqId: string;
  title: string;
  detail: string;
  risk: ApprovalRisk;
  timeoutMin?: number;
}

export interface ApprovalRequestCreatedMsg {
  type: 'approval_request_created';
  reqId: string;
  approvalId: string;
  threadId: string;
}

export interface ApprovalRequestResultMsg {
  type: 'approval_request_result';
  reqId: string;
  approvalId: string;
  decision: ApprovalDecision;
  note?: string;
}

export type ServerToWatchMsg =
  | WelcomeMsg
  | SnapshotMsg
  | ThreadUpdateMsg
  | ApprovalRequestMsg
  | ErrorMsg
  | PairOkMsg
  | ApprovalRequestCreatedMsg
  | ApprovalRequestResultMsg;

export type WatchToServerMsg =
  | HelloMsg
  | ApprovalResultMsg
  | ApprovalRequestCreateMsg;
