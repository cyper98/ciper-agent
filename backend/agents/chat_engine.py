"""Chat Engine Agent - handles multi-turn conversations"""
from typing import Iterator
from llm.ollama_client import OllamaClient
from context.context_manager import ContextManager

SYSTEM_PROMPT = """You are Ciper, a helpful AI coding assistant running locally on the user's machine.
You help developers with:
- Writing and reviewing code
- Debugging issues
- Explaining concepts and architecture
- Analyzing entire projects (file structure, dependencies, flow, optimization)
- Planning software projects

When you receive project context (file tree + key files), use it to give specific, accurate answers.
Reference actual file names and paths from the project. Be concise and practical.
Use code blocks when sharing code examples."""


class ChatEngine:
    def __init__(self, client: OllamaClient, context_manager: ContextManager):
        self.client = client
        self.context = context_manager

    def chat(
        self,
        session_id: str,
        model: str,
        message: str,
        temperature: float = 0.7,
        file_context: dict = {},
        project_context: dict = {},
    ) -> Iterator[str]:
        """Send a message and stream the response, maintaining conversation history."""

        user_content = message

        # ── Project context (workspace scan) ──────────────────────────────────
        if project_context:
            tree: list = project_context.get("tree", [])
            key_files: dict = project_context.get("keyFiles", {})
            root_name: str = project_context.get("rootName", "project")

            ctx = f"\n\n[Project: {root_name}]"
            ctx += f"\nFile tree ({len(tree)} files):\n"
            ctx += "\n".join(tree[:150])  # cap at 150 paths

            for filename, content in key_files.items():
                if content:
                    ctx += f"\n\n--- {filename} ---\n{content}"

            user_content += ctx

        # ── Current file / selection context ─────────────────────────────────
        elif file_context:
            lang = file_context.get("language", "")
            filename = file_context.get("fileName", "")
            selected = file_context.get("selectedText", "")
            snippet = file_context.get("fullContent", "")[:3000]

            ctx = f"\n\n[File: {filename} ({lang})]"
            if selected:
                ctx += f"\nSelected:\n```{lang}\n{selected}\n```"
            elif snippet:
                ctx += f"\nContent (truncated):\n```{lang}\n{snippet}\n```"

            user_content += ctx

        # ── Persist & build history ───────────────────────────────────────────
        self.context.add_message(session_id, role="user", content=user_content, model=model)
        history = self.context.get_history(session_id)
        messages = [{"role": "system", "content": SYSTEM_PROMPT}] + history

        # ── Stream response ───────────────────────────────────────────────────
        full_response = ""
        for chunk in self.client.chat(
            model=model,
            messages=messages,
            stream=True,
            temperature=temperature,
        ):
            full_response += chunk
            yield chunk

        self.context.add_message(session_id, role="assistant", content=full_response, model=model)
