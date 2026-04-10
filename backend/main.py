"""FastAPI Backend Server for Ciper Agent"""
import os
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse, PlainTextResponse
from pydantic import BaseModel
from dotenv import load_dotenv

from llm.ollama_client import OllamaClient
from agents.planner import PlanningEngine
from agents.code_analyzer import CodeAnalyzer
from agents.chat_engine import ChatEngine
from context.context_manager import ContextManager

load_dotenv()

app = FastAPI(
    title="Ciper Agent Backend",
    description="Local AI Agent Backend powered by Ollama",
    version="0.2.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

ollama_url = os.getenv("OLLAMA_API_URL", "http://localhost:11434")
ollama_client = OllamaClient(ollama_url)

context_manager = ContextManager()
planner = PlanningEngine(ollama_client)
code_analyzer = CodeAnalyzer(ollama_client)
chat_engine = ChatEngine(ollama_client, context_manager)


# ── Request/Response Models ──────────────────────────────────────────────────

class ChatRequest(BaseModel):
    model: str
    message: str
    session_id: str = "default"
    temperature: float = 0.7
    think: bool | None = None
    file_context: dict = {}
    project_context: dict = {}   # file tree + key file contents

class PlanRequest(BaseModel):
    input: str
    model: str

class CodeAnalysisRequest(BaseModel):
    code: str
    language: str = "python"
    model: str

class ModelPullRequest(BaseModel):
    model_name: str


# ── Routes ───────────────────────────────────────────────────────────────────

@app.get("/")
async def root():
    return {
        "app": "Ciper Agent Backend",
        "version": "0.2.0",
        "endpoints": [
            "GET  /api/health",
            "GET  /api/models",
            "POST /api/models/pull",
            "POST /api/chat",
            "POST /api/plan",
            "POST /api/analyze-code",
            "GET  /api/sessions",
            "GET  /api/chat/{session_id}/history",
            "GET  /api/chat/{session_id}/export",
            "GET  /api/chat/{session_id}/search?q=...",
            "DEL  /api/chat/{session_id}",
        ],
    }


@app.get("/api/health")
async def health():
    ollama_healthy = ollama_client.health_check()
    return {
        "status": "ok",
        "backend": "running",
        "ollama": ollama_healthy,
        "ollama_url": ollama_url,
    }


# ── Models ───────────────────────────────────────────────────────────────────

@app.get("/api/models")
async def list_models():
    models = ollama_client.list_models()
    if not models:
        raise HTTPException(
            status_code=503,
            detail="No models available. Make sure Ollama is running and has models installed.",
        )
    return {"models": models, "count": len(models)}


@app.post("/api/models/pull")
async def pull_model(request: ModelPullRequest):
    """Pull a model from Ollama registry (streaming progress lines)."""
    def generate():
        for status in ollama_client.pull_model(request.model_name):
            yield status + "\n"

    return StreamingResponse(generate(), media_type="text/plain")


# ── Chat ─────────────────────────────────────────────────────────────────────

@app.post("/api/chat")
async def chat(request: ChatRequest):
    """Chat endpoint - streams AI response, persists to SQLite."""
    if not request.model:
        raise HTTPException(status_code=400, detail="Model not specified")
    if not request.message:
        raise HTTPException(status_code=400, detail="Message is empty")

    def generate():
        for chunk in chat_engine.chat(
            session_id=request.session_id,
            model=request.model,
            message=request.message,
            temperature=request.temperature,
            think=request.think,
            file_context=request.file_context,
            project_context=request.project_context,
        ):
            yield chunk

    return StreamingResponse(generate(), media_type="text/event-stream")


@app.get("/api/sessions")
async def list_sessions():
    """List all chat sessions with message count and last activity."""
    return {"sessions": context_manager.list_sessions()}


@app.get("/api/chat/{session_id}/history")
async def get_history(session_id: str):
    """Return full message history for a session (with timestamps)."""
    messages = context_manager.get_full_history(session_id)
    return {"session_id": session_id, "messages": messages, "count": len(messages)}


@app.get("/api/chat/{session_id}/export")
async def export_chat(session_id: str):
    """Export conversation as Markdown plain text."""
    messages = context_manager.get_full_history(session_id)
    if not messages:
        raise HTTPException(status_code=404, detail=f"Session '{session_id}' has no history.")

    lines = [f"# Ciper Chat Export — Session: {session_id}\n"]
    for msg in messages:
        role_label = "**You**" if msg["role"] == "user" else "**Ciper**"
        ts = msg.get("ts", "")
        lines.append(f"\n---\n{role_label} _{ts}_\n\n{msg['content']}\n")

    markdown = "\n".join(lines)
    filename = f"ciper-{session_id}.md"
    return PlainTextResponse(
        content=markdown,
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@app.get("/api/chat/{session_id}/search")
async def search_history(session_id: str, q: str = Query(..., min_length=1)):
    """Search messages within a session."""
    results = context_manager.search(session_id, q)
    return {"session_id": session_id, "query": q, "results": results, "count": len(results)}


@app.delete("/api/chat/{session_id}")
async def clear_chat(session_id: str):
    """Delete all messages for a session."""
    context_manager.clear_session(session_id)
    return {"message": f"Session '{session_id}' cleared"}


# ── Agents ───────────────────────────────────────────────────────────────────

@app.post("/api/plan")
async def create_plan(request: PlanRequest):
    """Generate a structured plan for the given request."""
    plan = planner.generate_plan(model=request.model, user_request=request.input)
    return {"plan": plan}


@app.post("/api/analyze-code")
async def analyze_code(request: CodeAnalysisRequest):
    """Analyze provided code for issues, quality, and improvements."""
    analysis = code_analyzer.analyze(
        model=request.model,
        code=request.code,
        language=request.language,
    )
    return {"analysis": analysis}


# ── Entry Point ───────────────────────────────────────────────────────────────

if __name__ == "__main__":
    import uvicorn

    port = int(os.getenv("BACKEND_PORT", 8000))
    host = os.getenv("HOST", "127.0.0.1")

    print(f"Starting Ciper Agent Backend v0.2.0")
    print(f"Ollama URL: {ollama_url}")
    print(f"Server:     http://{host}:{port}")
    print(f"API docs:   http://{host}:{port}/docs")

    uvicorn.run(app, host=host, port=port, log_level="info")
