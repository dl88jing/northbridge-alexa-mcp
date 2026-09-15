"""Offline DemoModel for Strands Agents — deterministic, no AWS keys required."""

from __future__ import annotations

import json
from collections.abc import AsyncGenerator, AsyncIterable
from typing import Any, TypeVar

from strands.models.model import Model
from strands.types.content import Messages, SystemContentBlock
from strands.types.streaming import StreamEvent
from strands.types.tools import ToolChoice, ToolSpec

T = TypeVar("T")


class DemoModel(Model):
    """Judge-friendly offline model provider.

    Emits a single assistant turn summarizing the deterministic Northbridge
    offline policy pipeline. Swap for ``BedrockModel`` when AWS credentials
    and Bedrock access are available (see ``northbridge.agent.build_agent``).
    """

    def __init__(self, summary_provider: Any | None = None) -> None:
        self._config: dict[str, Any] = {
            "model_id": "northbridge-demo-model",
            "context_window_limit": 32_000,
        }
        self._summary_provider = summary_provider

    def update_config(self, **model_config: Any) -> None:
        self._config.update(model_config)

    def get_config(self) -> dict[str, Any]:
        return dict(self._config)

    async def structured_output(
        self,
        output_model: type[T],
        prompt: Messages,
        system_prompt: str | None = None,
        **kwargs: Any,
    ) -> AsyncGenerator[dict[str, T | Any], None]:
        text = self._render_summary()
        # Best-effort: wrap summary string if the model has a single str field
        fields = getattr(output_model, "model_fields", {}) or {}
        if len(fields) == 1:
            key = next(iter(fields))
            yield {"output": output_model(**{key: text})}
        else:
            yield {"output": output_model()}  # type: ignore[call-arg]

    async def stream(
        self,
        messages: Messages,
        tool_specs: list[ToolSpec] | None = None,
        system_prompt: str | None = None,
        *,
        tool_choice: ToolChoice | None = None,
        system_prompt_content: list[SystemContentBlock] | None = None,
        **kwargs: Any,
    ) -> AsyncIterable[StreamEvent]:
        text = self._render_summary()
        yield {"messageStart": {"role": "assistant"}}
        yield {"contentBlockDelta": {"delta": {"text": text}}}
        yield {"contentBlockStop": {}}
        yield {"messageStop": {"stopReason": "end_turn"}}
        yield {
            "metadata": {
                "usage": {
                    "inputTokens": 0,
                    "outputTokens": max(1, len(text) // 4),
                    "totalTokens": max(1, len(text) // 4),
                },
                "metrics": {"latencyMs": 12},
            }
        }

    def _render_summary(self) -> str:
        if self._summary_provider is not None:
            result = self._summary_provider()
            if isinstance(result, str):
                return result
            return json.dumps(result, indent=2)
        return (
            "Northbridge DemoModel online. "
            "Run the offline policy pipeline (list dues → parse → funding → "
            "anomaly → AUTO mark or HUMAN brief/notify). "
            "No Bedrock credentials required for this path."
        )
