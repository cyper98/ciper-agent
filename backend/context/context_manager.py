"""Context Manager - persistent conversation history via SQLite."""
from typing import List, Optional
import os
from context.db import get_connection, init_db

MAX_HISTORY = int(os.getenv("MAX_HISTORY", "0"))  # 0 = unlimited


class ContextManager:
    def __init__(self):
        init_db()

    def add_message(self, session_id: str, role: str, content: str, model: str = "") -> None:
        """Persist a message to the database."""
        with get_connection() as conn:
            conn.execute(
                "INSERT INTO messages (session, role, content, model) VALUES (?, ?, ?, ?)",
                (session_id, role, content, model),
            )
            conn.commit()

    def get_history(self, session_id: str, limit: Optional[int] = None) -> List[dict]:
        """Return session history for LLM (role + content only), optionally limited."""
        effective_limit = limit if limit is not None else MAX_HISTORY
        with get_connection() as conn:
            if effective_limit and effective_limit > 0:
                rows = conn.execute(
                    """
                    SELECT role, content FROM (
                        SELECT role, content, ts FROM messages
                        WHERE session = ?
                        ORDER BY ts DESC
                        LIMIT ?
                    ) ORDER BY ts ASC
                    """,
                    (session_id, effective_limit),
                ).fetchall()
            else:
                rows = conn.execute(
                    """
                    SELECT role, content FROM messages
                    WHERE session = ?
                    ORDER BY ts ASC
                    """,
                    (session_id,),
                ).fetchall()
        return [{"role": r["role"], "content": r["content"]} for r in rows]

    def get_full_history(self, session_id: str) -> List[dict]:
        """Return all messages with metadata (for export / search)."""
        with get_connection() as conn:
            rows = conn.execute(
                "SELECT id, role, content, model, ts FROM messages WHERE session = ? ORDER BY ts ASC",
                (session_id,),
            ).fetchall()
        return [dict(r) for r in rows]

    def search(self, session_id: str, query: str) -> List[dict]:
        """Full-text search within a session."""
        with get_connection() as conn:
            rows = conn.execute(
                "SELECT id, role, content, model, ts FROM messages WHERE session = ? AND content LIKE ? ORDER BY ts ASC",
                (session_id, f"%{query}%"),
            ).fetchall()
        return [dict(r) for r in rows]

    def clear_session(self, session_id: str) -> None:
        """Delete all messages for a session."""
        with get_connection() as conn:
            conn.execute("DELETE FROM messages WHERE session = ?", (session_id,))
            conn.commit()

    def list_sessions(self) -> List[dict]:
        """Return all sessions with message count and last activity."""
        with get_connection() as conn:
            rows = conn.execute(
                """
                SELECT session, COUNT(*) as count, MAX(ts) as last_active,
                       MIN(CASE WHEN role='user' THEN content END) as first_message
                FROM messages
                GROUP BY session
                ORDER BY last_active DESC
                """,
            ).fetchall()
        return [dict(r) for r in rows]
