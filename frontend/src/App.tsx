import React, { useState } from 'react';
import { Sidebar } from './components/Sidebar/Sidebar';
import { ChatPanel } from './components/ChatPanel/ChatPanel';
import { useConversations } from './hooks/useConversations';
import './App.css';

export default function App(): JSX.Element {
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const {
    conversations,
    activeConversationId,
    createConversation,
    switchConversation,
    deleteConversation,
  } = useConversations();

  const handleNewConversation = () => {
    createConversation();
  };

  return (
    <div className={`app ${sidebarCollapsed ? 'app--sidebar-collapsed' : ''}`}>
      <Sidebar
        conversations={conversations}
        activeConversationId={activeConversationId}
        onNewConversation={handleNewConversation}
        onSelectConversation={switchConversation}
        onDeleteConversation={deleteConversation}
        collapsed={sidebarCollapsed}
        onToggleCollapse={() => setSidebarCollapsed(!sidebarCollapsed)}
      />
      <ChatPanel />
    </div>
  );
}
