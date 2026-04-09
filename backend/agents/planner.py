"""Planning Engine Agent"""
from llm.ollama_client import OllamaClient

SYSTEM_PROMPT = """You are an expert software architect and project planner.
When given a user request, create a detailed, actionable plan with:
1. Problem analysis
2. Step-by-step implementation plan
3. Key decisions and trade-offs
4. Potential risks
5. Estimated effort

Format your response as structured markdown with clear sections and bullet points.
Be concise and practical."""


class PlanningEngine:
    def __init__(self, client: OllamaClient):
        self.client = client

    def generate_plan(self, model: str, user_request: str, temperature: float = 0.5) -> str:
        prompt = f"""User Request: {user_request}

Please create a detailed implementation plan for the above request."""

        result = ""
        for chunk in self.client.generate(
            model=model,
            prompt=prompt,
            stream=False,
            temperature=temperature,
            system=SYSTEM_PROMPT,
        ):
            result += chunk

        return result
