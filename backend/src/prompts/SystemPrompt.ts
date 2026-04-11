import { buildAgentSystemPrompt } from './templates/agent';
import { buildChatSystemPrompt } from './templates/chat';
import { ContextPayload } from '@ciper-agent/shared';
import { ContextBuilder } from '../context/ContextBuilder';

/** Agent mode — instructs the model to output structured JSON tool calls. */
export function buildSystemPrompt(
  contextPayload: ContextPayload,
  contextBuilder: ContextBuilder
): string {
  const contextSection = contextBuilder.format(contextPayload);
  return buildAgentSystemPrompt(contextSection);
}

/** Chat mode — conversational, plain text / markdown responses, no JSON constraints. */
export function buildChatPrompt(
  contextPayload: ContextPayload,
  contextBuilder: ContextBuilder
): string {
  const contextSection = contextBuilder.format(contextPayload);
  return buildChatSystemPrompt(contextSection);
}
