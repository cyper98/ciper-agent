import { buildAgentSystemPrompt } from './templates/agent';
import { ContextPayload } from '@ciper-agent/shared';
import { ContextBuilder } from '../context/ContextBuilder';

export function buildSystemPrompt(
  contextPayload: ContextPayload,
  contextBuilder: ContextBuilder
): string {
  const contextSection = contextBuilder.format(contextPayload);
  return buildAgentSystemPrompt(contextSection);
}
