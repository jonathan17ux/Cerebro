"""FastAPI router for agent run tracking — /agent-runs/* endpoints."""

from __future__ import annotations

import json

from fastapi import APIRouter, Depends, HTTPException, Query

from database import get_db
from models import AgentRun, _uuid_hex, _utcnow

from .schemas import (
    AgentRunCreate,
    AgentRunListResponse,
    AgentRunResponse,
    AgentRunUpdate,
)

router = APIRouter(tags=["agent-runs"])


def _run_to_response(run: AgentRun) -> AgentRunResponse:
    tools = None
    if run.tools_used and isinstance(run.tools_used, str):
        tools = json.loads(run.tools_used)
    return AgentRunResponse(
        id=run.id,
        expert_id=run.expert_id,
        conversation_id=run.conversation_id,
        status=run.status,
        turns=run.turns,
        total_tokens=run.total_tokens,
        tools_used=tools,
        error=run.error,
        started_at=run.started_at,
        completed_at=run.completed_at,
    )


@router.post("", response_model=AgentRunResponse, status_code=201)
def create_agent_run(body: AgentRunCreate, db=Depends(get_db)):
    run = AgentRun(
        id=body.id or _uuid_hex(),
        expert_id=body.expert_id,
        conversation_id=body.conversation_id,
        status=body.status,
    )
    db.add(run)
    db.commit()
    db.refresh(run)
    return _run_to_response(run)


@router.get("", response_model=AgentRunListResponse)
def list_agent_runs(
    conversation_id: str | None = None,
    expert_id: str | None = None,
    status: str | None = None,
    offset: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=200),
    db=Depends(get_db),
):
    q = db.query(AgentRun)
    if conversation_id:
        q = q.filter(AgentRun.conversation_id == conversation_id)
    if expert_id:
        q = q.filter(AgentRun.expert_id == expert_id)
    if status:
        q = q.filter(AgentRun.status == status)

    total = q.count()
    runs = q.order_by(AgentRun.started_at.desc()).offset(offset).limit(limit).all()
    return AgentRunListResponse(
        runs=[_run_to_response(r) for r in runs],
        total=total,
    )


@router.get("/{run_id}", response_model=AgentRunResponse)
def get_agent_run(run_id: str, db=Depends(get_db)):
    run = db.get(AgentRun, run_id)
    if not run:
        raise HTTPException(status_code=404, detail="Agent run not found")
    return _run_to_response(run)


@router.patch("/{run_id}", response_model=AgentRunResponse)
def update_agent_run(run_id: str, body: AgentRunUpdate, db=Depends(get_db)):
    run = db.get(AgentRun, run_id)
    if not run:
        raise HTTPException(status_code=404, detail="Agent run not found")

    updates = body.model_dump(exclude_unset=True)
    if "tools_used" in updates and updates["tools_used"] is not None:
        updates["tools_used"] = json.dumps(updates["tools_used"])

    for key, val in updates.items():
        setattr(run, key, val)
    db.commit()
    db.refresh(run)
    return _run_to_response(run)
