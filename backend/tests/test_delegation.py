"""Tests for delegation support — parent_run_id on agent runs."""

import uuid

import pytest

from database import get_db
from models import AgentRun, Expert


def _hex_id() -> str:
    return uuid.uuid4().hex


def _db(client):
    return next(get_db())


# ── parent_run_id tests ─────────────────────────────────────────


def test_create_agent_run_with_parent_run_id(client):
    """Agent run can be created with a parent_run_id."""
    parent_id = _hex_id()
    child_id = _hex_id()

    # Create parent run
    r = client.post("/agent-runs", json={
        "id": parent_id,
        "status": "running",
    })
    assert r.status_code == 201
    assert r.json()["parent_run_id"] is None

    # Create child run with parent_run_id
    r = client.post("/agent-runs", json={
        "id": child_id,
        "parent_run_id": parent_id,
        "status": "running",
    })
    assert r.status_code == 201
    assert r.json()["parent_run_id"] == parent_id


def test_agent_run_without_parent_run_id(client):
    """Agent run without parent_run_id defaults to None."""
    run_id = _hex_id()
    r = client.post("/agent-runs", json={
        "id": run_id,
        "status": "running",
    })
    assert r.status_code == 201
    assert r.json()["parent_run_id"] is None


def test_get_agent_run_includes_parent_run_id(client):
    """GET agent run includes parent_run_id."""
    parent_id = _hex_id()
    child_id = _hex_id()

    client.post("/agent-runs", json={"id": parent_id, "status": "running"})
    client.post("/agent-runs", json={
        "id": child_id,
        "parent_run_id": parent_id,
        "status": "running",
    })

    r = client.get(f"/agent-runs/{child_id}")
    assert r.status_code == 200
    assert r.json()["parent_run_id"] == parent_id


def test_list_agent_runs_includes_parent_run_id(client):
    """List endpoint includes parent_run_id in responses."""
    parent_id = _hex_id()
    child_id = _hex_id()

    client.post("/agent-runs", json={"id": parent_id, "status": "running"})
    client.post("/agent-runs", json={
        "id": child_id,
        "parent_run_id": parent_id,
        "status": "running",
    })

    r = client.get("/agent-runs")
    assert r.status_code == 200
    runs = r.json()["runs"]
    child_run = next(run for run in runs if run["id"] == child_id)
    assert child_run["parent_run_id"] == parent_id


def test_conversation_id_accepts_long_delegation_id(client):
    """conversation_id accepts long delegation-format strings."""
    run_id = _hex_id()
    parent_id = _hex_id()
    expert_id = _hex_id()
    long_conv_id = f"delegate:{parent_id}:{expert_id}"

    r = client.post("/agent-runs", json={
        "id": run_id,
        "conversation_id": long_conv_id,
        "parent_run_id": parent_id,
        "status": "running",
    })
    assert r.status_code == 201
    assert r.json()["conversation_id"] == long_conv_id


def test_create_agent_run_with_expert_id(client):
    """Agent run can reference an expert."""
    db = _db(client)
    expert = Expert(
        id=_hex_id(),
        name="Test Expert",
        description="A test expert",
    )
    db.add(expert)
    db.commit()

    run_id = _hex_id()
    r = client.post("/agent-runs", json={
        "id": run_id,
        "expert_id": expert.id,
        "parent_run_id": _hex_id(),
        "status": "running",
    })
    assert r.status_code == 201
    assert r.json()["expert_id"] == expert.id
    assert r.json()["parent_run_id"] is not None
