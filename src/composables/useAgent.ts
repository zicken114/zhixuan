import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';

export interface AgentRunOptions {
  query: string;
  llmConfig: {
    provider: string;
    api_key: string;
    base_url?: string;
    model: string;
  };
  conversationId?: string;
}

export interface AgentStep {
  step_number: number;
  thought: string;
  action: AgentAction;
  observation: string;
}

export interface AgentAction {
  type: 'think' | 'tool_call' | 'respond' | 'ask_user';
  content?: string;
  tool_name?: string;
  arguments?: Record<string, unknown>;
  question?: string;
}

export interface AgentRunResult {
  final_answer: string;
  steps: AgentStep[];
  tools_used: string[];
  requires_user_input: boolean;
}

export interface AgentCallbacks {
  onStart?: () => void;
  onStep?: (step: AgentStep) => void;
  onComplete?: (result: AgentRunResult) => void;
  onError?: (error: string) => void;
}

let unlistenComplete: UnlistenFn | null = null;
let unlistenError: UnlistenFn | null = null;

function cleanupListeners() {
  if (unlistenComplete) {
    unlistenComplete();
    unlistenComplete = null;
  }
  if (unlistenError) {
    unlistenError();
    unlistenError = null;
  }
}

export async function runAgent(
  options: AgentRunOptions,
  callbacks: AgentCallbacks
): Promise<string> {
  // Clean up old listeners
  cleanupListeners();

  callbacks.onStart?.();

  // Invoke the command first. The backend spawns the actual work asynchronously
  // and returns a conversation_id immediately. Events will arrive later.
  const conversationId = await invoke<string>('agent_run', {
    query: options.query,
    llmConfig: options.llmConfig,
    conversationId: options.conversationId,
  });

  // Set up listeners AFTER invoke returns, using the returned conversationId.
  // This is safe because the backend spawns the agent work in a new task,
  // so events can only arrive after this point.
  unlistenComplete = await listen<{ conversation_id: string; result: AgentRunResult }>(
    'agent:complete',
    (event) => {
      if (event.payload.conversation_id === conversationId) {
        callbacks.onComplete?.(event.payload.result);
        cleanupListeners();
      }
    }
  );

  unlistenError = await listen<{ conversation_id: string; error: string }>(
    'agent:error',
    (event) => {
      if (event.payload.conversation_id === conversationId) {
        callbacks.onError?.(event.payload.error);
        cleanupListeners();
      }
    }
  );

  return conversationId;
}

export function cancelAgent(conversationId: string): Promise<void> {
  return invoke('agent_cancel', { conversationId });
}

export function getAgentState(conversationId: string): Promise<unknown> {
  return invoke('agent_get_state', { conversationId });
}
