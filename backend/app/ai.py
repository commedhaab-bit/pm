import os
from typing import TypeVar

from openai import OpenAI
from pydantic import BaseModel

DEFAULT_MODEL = "gpt-5.6-luna"

T = TypeVar("T", bound=BaseModel)


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


def ask_structured(messages: list[dict[str, str]], response_model: type[T]) -> T:
    client = get_client()
    response = client.chat.completions.parse(
        model=get_model(),
        messages=messages,
        response_format=response_model,
    )
    message = response.choices[0].message
    if message.refusal:
        raise RuntimeError(f"OpenAI refused the request: {message.refusal}")
    if message.parsed is None:
        raise RuntimeError("OpenAI response had no parsed content")
    return message.parsed
