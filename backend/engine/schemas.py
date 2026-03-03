"""Pydantic request/response schemas for engine run records."""

from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel


# ── Run Record ────────────────────────────────────────────────────


class RunRecordCreate(BaseModel):
    id: str
    routine_id: str | None = None
    expert_id: str | None = None
    conversation_id: str | None = None
    run_type: str = "routine"
    trigger: str = "manual"
    dag_json: str | None = None
    total_steps: int = 0


class RunRecordUpdate(BaseModel):
    status: str | None = None
    completed_steps: int | None = None
    error: str | None = None
    failed_step_id: str | None = None
    completed_at: datetime | None = None
    duration_ms: int | None = None


class RunRecordResponse(BaseModel):
    id: str
    routine_id: str | None
    expert_id: str | None
    conversation_id: str | None
    status: str
    run_type: str
    trigger: str
    dag_json: str | None
    total_steps: int
    completed_steps: int
    error: str | None
    failed_step_id: str | None
    started_at: datetime
    completed_at: datetime | None
    duration_ms: int | None
    steps: list[StepRecordResponse] | None = None

    model_config = {"from_attributes": True}


class RunRecordListResponse(BaseModel):
    runs: list[RunRecordResponse]
    total: int


# ── Step Record ───────────────────────────────────────────────────


class StepRecordCreate(BaseModel):
    id: str
    step_id: str
    step_name: str
    action_type: str
    status: str = "pending"
    order_index: int = 0


class StepRecordUpdate(BaseModel):
    status: str | None = None
    input_json: str | None = None
    output_json: str | None = None
    summary: str | None = None
    error: str | None = None
    started_at: datetime | None = None
    completed_at: datetime | None = None
    duration_ms: int | None = None


class StepRecordResponse(BaseModel):
    id: str
    run_id: str
    step_id: str
    step_name: str
    action_type: str
    status: str
    summary: str | None
    error: str | None
    started_at: datetime | None
    completed_at: datetime | None
    duration_ms: int | None
    order_index: int

    model_config = {"from_attributes": True}


# ── Execution Events ─────────────────────────────────────────────


class EventCreate(BaseModel):
    seq: int
    event_type: str
    step_id: str | None = None
    payload_json: str
    timestamp: datetime


class EventBatchCreate(BaseModel):
    events: list[EventCreate]


class EventRecordResponse(BaseModel):
    id: str
    run_id: str
    seq: int
    event_type: str
    step_id: str | None
    payload_json: str
    timestamp: datetime

    model_config = {"from_attributes": True}
