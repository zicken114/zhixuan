import { aiClient, type ChatMessage } from '../utils/aiClient';
import { updateConversationSummary } from './useDatabase';

const SUMMARY_SYSTEM_PROMPT = `You are a research assistant. Summarize the following conversation into a single concise sentence (max 80 characters in Chinese or 120 in English) that captures the core conclusion or decision. Only output the summary sentence, no explanations, no quotes.`;

/**
 * Generate an AI-powered summary for a conversation and persist it.
 *
 * @param conversationId  The conversation ID in the database.
 * @param messages        The full message history (user + assistant pairs).
 * @returns               The generated summary text.
 */
export async function generateSessionSummary(
  conversationId: string,
  messages: ChatMessage[]
): Promise<string> {
  // Build a compact transcript for the AI.
  const transcript = messages
    .map((m) => {
      const prefix = m.role === 'user' ? 'User' : 'Assistant';
      const text =
        typeof m.content === 'string'
          ? m.content
          : JSON.stringify(m.content);
      return `${prefix}: ${text.slice(0, 500)}`;
    })
    .join('\n\n');

  const aiMessages = [
    { role: 'system' as const, content: SUMMARY_SYSTEM_PROMPT },
    { role: 'user' as const, content: transcript },
  ];

  const { text } = await aiClient.chatOnce(aiMessages, false, 'chat');
  const summary = text.trim().replace(/^["']|["']$/g, '');

  // Persist to SQLite.
  await updateConversationSummary(conversationId, summary);

  return summary;
}

/**
 * Check whether a summary should be generated based on the message count
 * and the user's configured interval.
 *
 * @param userMessageCount  Total number of user messages so far.
 * @param interval          Configured interval (0 = disabled).
 */
export function shouldGenerateSummary(
  userMessageCount: number,
  interval: number
): boolean {
  if (interval <= 0) return false;
  return userMessageCount > 0 && userMessageCount % interval === 0;
}
