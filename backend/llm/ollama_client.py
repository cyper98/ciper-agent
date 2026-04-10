"""Ollama API Client"""
import requests
import json
from typing import Iterator, List

NEED_CONTINUE_TAG = "<ciper:need_continue />"


class OllamaClient:
    def __init__(self, api_url: str = "http://localhost:11434"):
        self.api_url = api_url.rstrip('/')

    def health_check(self) -> bool:
        """Check if Ollama server is running"""
        try:
            response = requests.head(f"{self.api_url}/", timeout=2)
            return response.status_code == 200
        except Exception as e:
            print(f"Ollama health check failed: {e}")
            return False

    def list_models(self) -> List[dict]:
        """Get list of available models"""
        try:
            response = requests.get(f"{self.api_url}/api/tags", timeout=10)
            response.raise_for_status()
            data = response.json()
            return data.get("models", [])
        except Exception as e:
            print(f"Failed to list models: {e}")
            return []

    def generate(
        self,
        model: str,
        prompt: str,
        stream: bool = True,
        temperature: float = 0.7,
        top_p: float = 0.9,
        system: str = ""
    ) -> Iterator[str]:
        """Generate text response from Ollama"""
        payload = {
            "model": model,
            "prompt": prompt,
            "stream": stream,
            "options": {
                "temperature": temperature,
                "top_p": top_p
            }
        }

        if system:
            payload["system"] = system

        try:
            response = requests.post(
                f"{self.api_url}/api/generate",
                json=payload,
                stream=stream,
                timeout=120
            )
            response.raise_for_status()

            if stream:
                for line in response.iter_lines():
                    if line:
                        try:
                            data = json.loads(line)
                            if "response" in data:
                                yield data["response"]
                        except json.JSONDecodeError:
                            continue
            else:
                data = response.json()
                yield data.get("response", "")

        except Exception as e:
            yield f"Error: {str(e)}"

    def chat(
        self,
        model: str,
        messages: List[dict],
        stream: bool = True,
        temperature: float = 0.7,
        think: bool | None = None,
        images: List[str] | None = None,
    ) -> Iterator[str]:
        """Chat endpoint using /api/chat (supports conversation history)"""
        req_messages = [dict(m) for m in messages]
        if images:
            # Ollama expects base64 images on a user message item.
            for msg in reversed(req_messages):
                if msg.get("role") == "user":
                    msg["images"] = images
                    break

        payload = {
            "model": model,
            "messages": req_messages,
            "stream": stream,
            "options": {
                "temperature": temperature,
            }
        }
        if think is not None:
            payload["think"] = bool(think)

        try:
            response = requests.post(
                f"{self.api_url}/api/chat",
                json=payload,
                stream=stream,
                timeout=120
            )
            response.raise_for_status()

            if stream:
                needs_continue = False
                for line in response.iter_lines():
                    if line:
                        try:
                            data = json.loads(line)
                            if "message" in data and "content" in data["message"]:
                                yield data["message"]["content"]
                            if data.get("done"):
                                reason = str(data.get("done_reason", "")).lower()
                                if reason in {"length", "max_tokens"}:
                                    needs_continue = True
                        except json.JSONDecodeError:
                            continue
                if needs_continue:
                    yield NEED_CONTINUE_TAG
            else:
                data = response.json()
                content = data.get("message", {}).get("content", "")
                reason = str(data.get("done_reason", "")).lower()
                if reason in {"length", "max_tokens"}:
                    content += NEED_CONTINUE_TAG
                yield content

        except Exception as e:
            yield f"Error: {str(e)}"

    def pull_model(self, model_name: str) -> Iterator[str]:
        """Pull a model from Ollama registry"""
        payload = {"name": model_name, "stream": True}

        try:
            response = requests.post(
                f"{self.api_url}/api/pull",
                json=payload,
                stream=True,
                timeout=300
            )
            response.raise_for_status()

            for line in response.iter_lines():
                if line:
                    try:
                        data = json.loads(line)
                        status = data.get("status", "")
                        yield status
                    except json.JSONDecodeError:
                        continue

        except Exception as e:
            yield f"Error pulling model: {str(e)}"
