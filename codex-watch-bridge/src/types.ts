// Shared types for the watch bridge protocol and internal state.

export type ThreadPhase =
  | 'running'
  | 'waiting_approval'
  | 'idle'
  | 'aborted'
  | 'unknown';

export type TimelineEventKind =
  | 'started'
  | 'completed'
  | 'aborted'
  | 'item_completed'
  | 'approval_requested'
  | 'approval_resolved'
  | 'control_requested'
  | 'message'
  | 'warning';

export interface TimelineEvent {
  id: string;
  tsMs: number;
  kind: TimelineEventKind;
  title: string;
  detail?: string;
}

export type ApprovalRisk = 'low' | 'medium' | 'high' | 'unknown';

export type ApprovalDecision = 'approve' | 'reject' | 'timeout';

export interface ApprovalEntry {
  id: string;
  title: string;
  detail: string;
  risk: ApprovalRisk;
  createdAtMs: number;
  source: 'rollout' | 'mcp' | 'demo';
  action?: string;
  targetPath?: string;
  affectedFiles?: string[];
  commandPreview?: string;
  reasons?: string[];
  reversible?: boolean;
  requiresStrongConfirm?: boolean;
  metadata?: Record<string, unknown>;
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
  timeline?: TimelineEvent[];
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

export type TaskControlAction =
  | 'stop'
  | 'pause'
  | 'resume'
  | 'retry'
  | 'cancel_approval';

export interface TaskControlMsg {
  type: 'task_control';
  threadId: string;
  action: TaskControlAction;
  reason?: string;
}

export type WatchInstructionStatus =
  | 'queued'
  | 'dispatched'
  | 'delivered'
  | 'completed'
  | 'failed'
  | 'expired';

export interface WatchInstruction {
  id: string;
  threadId: string;
  threadTitle: string;
  text: string;
  source: 'watch_quick_reply' | 'watch_voice';
  status: WatchInstructionStatus;
  createdAtMs: number;
  deliveredAtMs?: number;
  completedAtMs?: number;
  result?: string;
}

export interface ThreadMessageMsg {
  type: 'thread_message';
  threadId: string;
  text: string;
  source?: 'watch_quick_reply' | 'watch_voice';
  requestId?: string;
}

export interface ControlResultMsg {
  type: 'control_result';
  threadId: string;
  action: TaskControlAction | 'send_message';
  accepted: boolean;
  supported: boolean;
  message: string;
  tsMs: number;
  requestId?: string;
}

export interface WatchInstructionUpdateMsg {
  type: 'watch_instruction_update';
  instruction: WatchInstruction;
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
  action?: string;
  targetPath?: string;
  affectedFiles?: string[];
  commandPreview?: string;
  reasons?: string[];
  reversible?: boolean;
  metadata?: Record<string, unknown>;
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

export interface WatchInstructionGetMsg {
  type: 'watch_instruction_get';
  reqId: string;
  threadId?: string;
  waitSeconds?: number;
}

export interface WatchInstructionGetResultMsg {
  type: 'watch_instruction_get_result';
  reqId: string;
  instructions: WatchInstruction[];
}

export interface WatchInstructionCompleteMsg {
  type: 'watch_instruction_complete';
  reqId: string;
  id: string;
  status: 'completed' | 'failed';
  result?: string;
}

export interface WatchInstructionCompleteResultMsg {
  type: 'watch_instruction_complete_result';
  reqId: string;
  accepted: boolean;
  instruction?: WatchInstruction;
  message: string;
}

export type ServerToWatchMsg =
  | WelcomeMsg
  | SnapshotMsg
  | ThreadUpdateMsg
  | ApprovalRequestMsg
  | ErrorMsg
  | PairOkMsg
  | ApprovalRequestCreatedMsg
  | ApprovalRequestResultMsg
  | ControlResultMsg
  | WatchInstructionUpdateMsg
  | WatchInstructionGetResultMsg
  | WatchInstructionCompleteResultMsg;

export type WatchToServerMsg =
  | HelloMsg
  | ApprovalResultMsg
  | ApprovalRequestCreateMsg
  | TaskControlMsg
  | ThreadMessageMsg
  | WatchInstructionGetMsg
  | WatchInstructionCompleteMsg;
