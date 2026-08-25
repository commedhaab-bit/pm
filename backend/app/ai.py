import os

from openai import OpenAI

DEFAULT_MODEL = "gpt-5.6-luna"


def get_model() -> str:
    return os.environ.get("OPENAI_MODEL", DEFAULT_MODEL)


def get_client() -> OpenAI:
    api_key = os.environ.get("OPENAI_API_KEY")
    if not api_key:
        raise RuntimeError(
            "OPENAI_API_KEY is not set. Add it to the project root .env file."
        )
    return OpenAI(api_key=api_key)


def ask(messages: list[dict[str, str]]) -> str:
    client = get_client()
    response = client.chat.completions.create(
        model=get_model(),
        messages=messages,
    )
    content = response.choices[0].message.content
    if content is None:
        raise RuntimeError("OpenAI response had no content")
    return content
