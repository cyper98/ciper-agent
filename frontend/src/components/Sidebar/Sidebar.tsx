import React, { useState } from 'react';
import { ConversationSummary } from '@ciper-agent/shared';
import './Sidebar.css';

interface SidebarProps {
  conversations: ConversationSummary[];
  activeConversationId: string | null;
  onNewConversation: () => void;
  onSelectConversation: (id: string) => void;
  onDeleteConversation: (id: string) => void;
  collapsed: boolean;
  onToggleCollapse: () => void;
}

export function Sidebar({
  conversations,
  activeConversationId,
  onNewConversation,
  onSelectConversation,
  onDeleteConversation,
  collapsed,
  onToggleCollapse,
}: SidebarProps): JSX.Element {
  const [isDark, setIsDark] = useState(true);

  const toggleTheme = () => {
    setIsDark(!isDark);
    document.documentElement.classList.toggle('light', isDark);
  };

  const formatDate = (timestamp: number): string => {
    const date = new Date(timestamp);
    const now = new Date();
    const diff = now.getTime() - date.getTime();
    
    if (diff < 60000) return 'Just now';
    if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
    if (diff < 604800000) return `${Math.floor(diff / 86400000)}d ago`;
    return date.toLocaleDateString();
  };

  const truncate = (text: string, maxLength: number): string => {
    if (text.length <= maxLength) return text;
    return text.slice(0, maxLength).trim() + '...';
  };

  if (collapsed) {
    return (
      <div className="sidebar sidebar--collapsed">
        <button className="sidebar__toggle" onClick={onToggleCollapse} title="Expand sidebar">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M9 18l6-6-6-6"/>
          </svg>
        </button>
        <button className="sidebar__new-btn sidebar__new-btn--collapsed" onClick={onNewConversation} title="New conversation">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M12 5v14M5 12h14"/>
          </svg>
        </button>
        <button className="sidebar__theme-btn sidebar__theme-btn--collapsed" onClick={toggleTheme} title="Toggle theme">
          {isDark ? '☀️' : '🌙'}
        </button>
        <div className="sidebar__collapsed-list">
          {conversations.slice(0, 8).map((conv, i) => (
            <button
              key={conv.id}
              className={`sidebar__collapsed-item ${conv.id === activeConversationId ? 'sidebar__collapsed-item--active' : ''}`}
              onClick={() => onSelectConversation(conv.id)}
              title={conv.title}
            >
              {i + 1}
            </button>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="sidebar">
      <div className="sidebar__header">
        <h2 className="sidebar__title">Conversations</h2>
        <div className="sidebar__header-actions">
          <button className="sidebar__theme-btn" onClick={toggleTheme} title="Toggle theme">
            {isDark ? '☀️' : '🌙'}
          </button>
          <button className="sidebar__toggle" onClick={onToggleCollapse} title="Collapse sidebar">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M15 18l-6-6 6-6"/>
            </svg>
          </button>
        </div>
      </div>
      
      <button className="sidebar__new-btn" onClick={onNewConversation}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
          <path d="M12 5v14M5 12h14"/>
        </svg>
        New conversation
      </button>

      <div className="sidebar__list">
        {conversations.length === 0 ? (
          <div className="sidebar__empty">
            <span className="sidebar__empty-icon">💬</span>
            <p>No conversations yet</p>
            <p className="sidebar__empty-hint">Start a new conversation</p>
          </div>
        ) : (
          conversations.map(conv => (
            <div
              key={conv.id}
              className={`sidebar__item ${conv.id === activeConversationId ? 'sidebar__item--active' : ''}`}
            >
              <button
                className="sidebar__item-content"
                onClick={() => onSelectConversation(conv.id)}
              >
                <div className="sidebar__item-header">
                  <span className="sidebar__item-title">{conv.title}</span>
                  <button
                    className="sidebar__item-delete"
                    onClick={(e) => {
                      e.stopPropagation();
                      onDeleteConversation(conv.id);
                    }}
                    title="Delete"
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M18 6L6 18M6 6l12 12"/>
                    </svg>
                  </button>
                </div>
                <div className="sidebar__item-preview">{truncate(conv.preview, 35)}</div>
                <div className="sidebar__item-footer">
                  <span className="sidebar__item-time">{formatDate(conv.updatedAt)}</span>
                  <span className="sidebar__item-tokens">{conv.tokenCount.toLocaleString()} tk</span>
                </div>
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
