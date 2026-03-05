"""Pydantic request/response schemas for agent runs."""

from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel


class AgentRunCreate(BaseModel):
    id: str
    expert_id: str | None = None
    conversation_id: str | None = None
    parent_run_id: str | None = None
    status: str = "running"


class AgentRunUpdate(BaseModel):
    status: str | None = None
    turns: int | None = None
    total_tokens: int | None = None
    tools_used: list[str] | None = None
    error: str | None = None
    completed_at: datetime | None = None


class AgentRunResponse(BaseModel):
    id: str
    expert_id: str | None
    conversation_id: str | None
    parent_run_id: str | None = None
    status: str
    turns: int
    total_tokens: int
    tools_used: list[str] | None = None
    error: str | None
    started_at: datetime
    completed_at: datetime | None

    model_config = {"from_attributes": True}


class AgentRunListResponse(BaseModel):
    runs: list[AgentRunResponse]
    total: int
