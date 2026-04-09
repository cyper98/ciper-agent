"""Chat Engine Agent - handles multi-turn conversations."""
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
Use code blocks when sharing code examples.

## FILE DISCOVERY + READING (Agentic)
When you need to discover relevant files first, output a search request BEFORE read requests:
<ciper:search query="auth middleware token" />

Then request exact file reads:
<ciper:read path="src/components/Button.tsx" />
<ciper:read path="src/utils/api.ts" />

The IDE asks user permission for search/read requests and returns results.
Only request files you genuinely need - be specific and targeted.

## FILE OPERATIONS
When the user asks you to CREATE or EDIT files, use ONE of these two formats (both work):

Format A (XML):
<ciper:write path="src/components/Button.tsx">
complete file content here
</ciper:write>

Format B (fence):
```ciper:write path="src/components/Button.tsx"
complete file content here
```

To delete a file, use:
<ciper:delete path="src/old-file.ts" />

RULES:
- Always output the COMPLETE file content, never partial snippets
- Use paths relative to the project root (e.g. src/index.ts, not /absolute/path)
- You can output multiple file operations in one response
- After file operations, briefly explain what you changed
- The IDE will show Accept/Reject controls - you do not need to ask confirmation
- Only use these formats when actually creating/modifying files, not for examples"""


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

        # Project context (workspace scan)
        if project_context:
            tree: list = project_context.get("tree", [])
            key_files: dict = project_context.get("keyFiles", {})
            root_name: str = project_context.get("rootName", "project")

            ctx = f"\n\n[Project: {root_name}]"
            ctx += f"\nFile tree ({len(tree)} files):\n"
            ctx += "\n".join(tree[:150])

            for filename, content in key_files.items():
                if content:
                    ctx += f"\n\n--- {filename} ---\n{content}"

            user_content += ctx

        # Current file / selection context
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

        # Manually attached files
        attached = file_context.get("attachedFiles", []) if file_context else []
        for af in attached:
            name = af.get("path", af.get("name", ""))
            lang = af.get("language", "")
            content = af.get("content", "")[:5000]
            user_content += f"\n\n[Attached: {name}]\n```{lang}\n{content}\n```"

        # Pasted images for multimodal models
        image_data = file_context.get("images", []) if file_context else []
        if image_data:
            user_content += f"\n\n[Attached images: {len(image_data)}]"

        # Persist + build history
        self.context.add_message(session_id, role="user", content=user_content, model=model)
        history = self.context.get_history(session_id)
        messages = [{"role": "system", "content": SYSTEM_PROMPT}] + history

        # Stream response
        full_response = ""
        for chunk in self.client.chat(
            model=model,
            messages=messages,
            stream=True,
            temperature=temperature,
            images=image_data if image_data else None,
        ):
            full_response += chunk
            yield chunk

        self.context.add_message(session_id, role="assistant", content=full_response, model=model)
