import { useState, useCallback, useEffect } from 'react';
import { Conversation, ConversationSummary, ChatMessage } from '@ciper-agent/shared';
import { sendToExtension } from '../vscodeApi';
import { useVSCodeMessage } from './useVSCodeMessage';

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function getPreview(messages: ChatMessage[]): string {
  const firstUser = messages.find(m => m.role === 'user');
  if (firstUser) {
    return firstUser.content.slice(0, 60);
  }
  return '';
}

export interface UseConversationsReturn {
  conversations: ConversationSummary[];
  activeConversationId: string | null;
  activeConversation: Conversation | null;
  createConversation: () => void;
  switchConversation: (id: string) => void;
  deleteConversation: (id: string) => void;
  updateConversationMessages: (messages: ChatMessage[], tokenCount: number) => void;
  loadConversationMessages: () => void;
}

export function useConversations(): UseConversationsReturn {
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [activeConversation, setActiveConversation] = useState<Conversation | null>(null);

  useVSCodeMessage((msg) => {
    switch (msg.kind) {
      case 'RESTORE_CONVERSATIONS':
        setConversations(msg.conversations);
        break;

      case 'CONVERSATION_LOADED':
        setActiveConversation(msg.conversation);
        break;
    }
  });

  const createConversation = useCallback(() => {
    const newConv: Conversation = {
      id: generateId(),
      title: 'New conversation',
      messages: [],
      tokenCount: 0,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    const summary: ConversationSummary = {
      id: newConv.id,
      title: newConv.title,
      tokenCount: 0,
      messageCount: 0,
      createdAt: newConv.createdAt,
      updatedAt: newConv.updatedAt,
      preview: '',
    };

    setConversations(prev => [summary, ...prev]);
    setActiveConversationId(newConv.id);
    setActiveConversation(newConv);
    sendToExtension({ kind: 'NEW_CONVERSATION' });
  }, []);

  const switchConversation = useCallback((id: string) => {
    setActiveConversationId(id);
    sendToExtension({ kind: 'LOAD_CONVERSATION', conversationId: id });
  }, []);

  const deleteConversation = useCallback((id: string) => {
    setConversations(prev => prev.filter(c => c.id !== id));
    if (activeConversationId === id) {
      setActiveConversationId(null);
      setActiveConversation(null);
    }
    sendToExtension({ kind: 'DELETE_CONVERSATION', conversationId: id });
  }, [activeConversationId]);

  const updateConversationMessages = useCallback((messages: ChatMessage[], tokenCount: number) => {
    if (!activeConversationId) return;

    const title = (() => {
      const firstUser = messages.find(m => m.role === 'user');
      if (firstUser) {
        const content = firstUser.content.trim();
        if (content.length <= 40) return content;
        return content.slice(0, 40) + '...';
      }
      return 'New conversation';
    })();

    const updated: Conversation = {
      id: activeConversationId,
      title,
      messages,
      tokenCount,
      createdAt: activeConversation?.createdAt ?? Date.now(),
      updatedAt: Date.now(),
    };

    const summary: ConversationSummary = {
      id: activeConversationId,
      title,
      tokenCount,
      messageCount: messages.length,
      createdAt: updated.createdAt,
      updatedAt: updated.updatedAt,
      preview: getPreview(messages),
    };

    setActiveConversation(updated);
    setConversations(prev =>
      prev.map(c => (c.id === activeConversationId ? summary : c))
    );
  }, [activeConversationId, activeConversation?.createdAt]);

  const loadConversationMessages = useCallback(() => {
    if (activeConversation) {
      sendToExtension({
        kind: 'SAVE_HISTORY',
        messages: activeConversation.messages,
      });
    }
  }, [activeConversation]);

  return {
    conversations,
    activeConversationId,
    activeConversation,
    createConversation,
    switchConversation,
    deleteConversation,
    updateConversationMessages,
    loadConversationMessages,
  };
}
