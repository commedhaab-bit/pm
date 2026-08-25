import pytest

from app.ai import ask


@pytest.mark.live
def test_ask_answers_2_plus_2():
    reply = ask(
        [{"role": "user", "content": "What is 2+2? Reply with only the number."}]
    )
    assert "4" in reply
