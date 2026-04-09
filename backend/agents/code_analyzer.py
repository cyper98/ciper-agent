"""Code Analysis Agent"""
from llm.ollama_client import OllamaClient

SYSTEM_PROMPT = """You are an expert code reviewer with deep knowledge of software engineering best practices.
When analyzing code, provide:
1. Issues found (bugs, security vulnerabilities, performance problems)
2. Code quality suggestions
3. Best practices recommendations
4. An improved version of the code (if applicable)

Be concise, specific, and actionable. Format output as structured markdown."""


class CodeAnalyzer:
    def __init__(self, client: OllamaClient):
        self.client = client

    def analyze(self, model: str, code: str, language: str = "python", temperature: float = 0.3) -> str:
        prompt = f"""Please analyze the following {language} code:

```{language}
{code}
```

Provide a thorough code review with specific, actionable feedback."""

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

    def explain(self, model: str, code: str, language: str = "python") -> str:
        prompt = f"""Please explain what this {language} code does:

```{language}
{code}
```

Provide a clear, beginner-friendly explanation."""

        result = ""
        for chunk in self.client.generate(
            model=model,
            prompt=prompt,
            stream=False,
            temperature=0.5,
        ):
            result += chunk

        return result

    def generate_tests(self, model: str, code: str, language: str = "python") -> str:
        prompt = f"""Generate comprehensive unit tests for this {language} code:

```{language}
{code}
```

Use the appropriate testing framework for the language (pytest for Python, Jest for JS/TS, etc.).
Include edge cases and error scenarios."""

        result = ""
        for chunk in self.client.generate(
            model=model,
            prompt=prompt,
            stream=False,
            temperature=0.3,
        ):
            result += chunk

        return result
