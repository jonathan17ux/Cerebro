"""Tests for /tasks/* endpoints — task CRUD, lifecycle, plans, events, workspace."""

import json
import os
import uuid


def _hex_id() -> str:
    return uuid.uuid4().hex


# ── Helpers ────────────────────────────────────────────────────────


def _create_task(client, **overrides):
    """Helper: create a task and return the response dict."""
    body = {
        "title": "Test Task",
        "goal": "Build a test application",
        **overrides,
    }
    r = client.post("/tasks", json=body)
    assert r.status_code == 201
    return r.json()


def _start_run(client, task_id, phase="execute"):
    """Helper: start a run on a task and return the response dict."""
    r = client.post(f"/tasks/{task_id}/run", json={"phase": phase})
    assert r.status_code == 200
    return r.json()


def _set_clarifications(client, task_id, questions):
    """Helper: set clarification questions on a task."""
    r = client.post(f"/tasks/{task_id}/clarifications", json={"questions": questions})
    assert r.status_code == 200
    return r.json()


def _submit_answers(client, task_id, answers):
    """Helper: submit clarification answers."""
    r = client.post(f"/tasks/{task_id}/clarify", json={"answers": answers})
    assert r.status_code == 200
    return r.json()


def _upsert_plan(client, task_id, phases, kind=None):
    """Helper: upsert a plan on a task."""
    body = {"phases": phases}
    if kind:
        body["kind"] = kind
    r = client.post(f"/tasks/{task_id}/plan", json=body)
    assert r.status_code == 200
    return r.json()


def _finalize(client, task_id, status="completed", **extras):
    """Helper: finalize a task."""
    body = {"status": status, **extras}
    r = client.post(f"/tasks/{task_id}/finalize", json=body)
    assert r.status_code == 200
    return r.json()


# ═══════════════════════════════════════════════════════════════════
#  1. Task CRUD
# ═══════════════════════════════════════════════════════════════════


def test_create_task_basic(client):
    t = _create_task(client, title="My App", goal="Build a weather app")
    assert t["title"] == "My App"
    assert t["goal"] == "Build a weather app"
    assert t["status"] == "pending"
    assert t["id"]
    assert t["created_at"]
    assert t["deliverable_kind"] == "markdown"
    assert t["max_turns"] == 60
    assert t["max_phases"] == 6
    assert t["skip_clarification"] is False


def test_create_task_with_options(client):
    t = _create_task(
        client,
        title="Code App",
        goal="Build a chat app",
        max_turns=100,
        max_phases=10,
        skip_clarification=True,
        template_id="tmpl_chat",
    )
    assert t["max_turns"] == 100
    assert t["max_phases"] == 10
    assert t["skip_clarification"] is True
    assert t["template_id"] == "tmpl_chat"


def test_list_tasks_empty(client):
    r = client.get("/tasks")
    assert r.status_code == 200
    body = r.json()
    assert body["tasks"] == []
    assert body["total"] == 0


def test_list_tasks_with_items(client):
    _create_task(client, title="A")
    _create_task(client, title="B")
    _create_task(client, title="C")
    r = client.get("/tasks")
    assert r.status_code == 200
    body = r.json()
    assert body["total"] == 3
    assert len(body["tasks"]) == 3


def test_list_tasks_filter_by_status(client):
    t1 = _create_task(client, title="Pending One")
    t2 = _create_task(client, title="Will Complete")

    # Start and finalize t2
    _start_run(client, t2["id"])
    _finalize(client, t2["id"], status="completed")

    r = client.get("/tasks", params={"status": "pending"})
    body = r.json()
    assert body["total"] == 1
    assert body["tasks"][0]["id"] == t1["id"]

    r = client.get("/tasks", params={"status": "completed"})
    body = r.json()
    assert body["total"] == 1
    assert body["tasks"][0]["id"] == t2["id"]


def test_list_tasks_pagination(client):
    for i in range(5):
        _create_task(client, title=f"Task {i}")

    r = client.get("/tasks", params={"offset": 0, "limit": 2})
    body = r.json()
    assert body["total"] == 5
    assert len(body["tasks"]) == 2

    r = client.get("/tasks", params={"offset": 4, "limit": 2})
    body = r.json()
    assert body["total"] == 5
    assert len(body["tasks"]) == 1


def test_get_task_detail(client):
    t = _create_task(client, title="Detail Test")
    r = client.get(f"/tasks/{t['id']}")
    assert r.status_code == 200
    body = r.json()
    assert body["id"] == t["id"]
    assert body["title"] == "Detail Test"
    # Detail response includes run and child_runs
    assert body["run"] is None
    assert body["child_runs"] == []


def test_get_task_not_found(client):
    r = client.get("/tasks/nonexistent")
    assert r.status_code == 404


def test_delete_task(client):
    t = _create_task(client)
    r = client.delete(f"/tasks/{t['id']}")
    assert r.status_code == 204

    # Verify it's gone
    r = client.get(f"/tasks/{t['id']}")
    assert r.status_code == 404


def test_delete_task_not_found(client):
    """Deleting a nonexistent task returns 204 (idempotent)."""
    r = client.delete("/tasks/nonexistent")
    assert r.status_code == 204


# ═══════════════════════════════════════════════════════════════════
#  2. Task lifecycle: full clarification flow
# ═══════════════════════════════════════════════════════════════════


def test_full_lifecycle_with_clarification(client):
    # Step 1: Create task
    t = _create_task(client, title="Full Lifecycle", goal="Build a dashboard")
    assert t["status"] == "pending"

    # Step 2: Start clarify run
    run_resp = _start_run(client, t["id"], phase="clarify")
    assert run_resp["task_id"] == t["id"]
    assert run_resp["run_id"]
    assert run_resp["conversation_id"]
    assert run_resp["workspace_path"]

    # Verify task status
    detail = client.get(f"/tasks/{t['id']}").json()
    assert detail["status"] == "clarifying"

    # Step 3: Set clarification questions (simulating what the agent does)
    questions = [
        {"id": "q1", "q": "What tech stack?", "kind": "select", "options": ["React", "Vue"]},
        {"id": "q2", "q": "Need auth?", "kind": "bool"},
    ]
    _set_clarifications(client, t["id"], questions)

    detail = client.get(f"/tasks/{t['id']}").json()
    assert detail["status"] == "awaiting_clarification"
    assert detail["clarifications"]["questions"] == questions

    # Step 4: Submit answers
    answers = [
        {"id": "q1", "answer": "React"},
        {"id": "q2", "answer": True},
    ]
    clarify_resp = _submit_answers(client, t["id"], answers)
    assert clarify_resp["task_id"] == t["id"]
    assert "React" in clarify_resp["answers_block"]

    # Step 5: Start execute run
    exec_resp = _start_run(client, t["id"], phase="execute")
    assert exec_resp["run_id"]  # new run id for execute phase

    detail = client.get(f"/tasks/{t['id']}").json()
    assert detail["status"] == "running"
    assert detail["started_at"] is not None

    # Step 6: Finalize
    final = _finalize(client, t["id"], status="completed", deliverable_markdown="# Done")
    assert final["status"] == "completed"
    assert final["deliverable_markdown"] == "# Done"
    assert final["completed_at"] is not None


# ═══════════════════════════════════════════════════════════════════
#  3. Task lifecycle: skip clarification
# ═══════════════════════════════════════════════════════════════════


def test_lifecycle_skip_clarification(client):
    t = _create_task(client, skip_clarification=True)
    assert t["skip_clarification"] is True

    # Go directly to execute
    run_resp = _start_run(client, t["id"], phase="execute")
    assert run_resp["task_id"] == t["id"]

    detail = client.get(f"/tasks/{t['id']}").json()
    assert detail["status"] == "running"
    assert detail["started_at"] is not None

    final = _finalize(client, t["id"], status="completed")
    assert final["status"] == "completed"
    assert final["completed_at"] is not None


# ═══════════════════════════════════════════════════════════════════
#  4. Plan management
# ═══════════════════════════════════════════════════════════════════


def test_upsert_plan(client):
    t = _create_task(client)
    _start_run(client, t["id"])

    phases = [
        {"id": "p1", "name": "Setup", "description": "Initialize project"},
        {"id": "p2", "name": "Build", "description": "Implement features"},
    ]
    resp = _upsert_plan(client, t["id"], phases, kind="code_app")
    assert resp["plan"] is not None
    assert len(resp["plan"]["phases"]) == 2
    assert resp["plan"]["phases"][0]["name"] == "Setup"
    assert resp["plan"]["phases"][0]["status"] == "pending"
    assert resp["deliverable_kind"] == "code_app"


def test_upsert_plan_replaces_previous(client):
    t = _create_task(client)
    _start_run(client, t["id"])

    _upsert_plan(client, t["id"], [
        {"id": "p1", "name": "Phase A", "description": "First"},
    ])

    resp = _upsert_plan(client, t["id"], [
        {"id": "p2", "name": "Phase B", "description": "Replaced"},
        {"id": "p3", "name": "Phase C", "description": "New"},
    ])
    assert len(resp["plan"]["phases"]) == 2
    assert resp["plan"]["phases"][0]["id"] == "p2"


def test_update_phase_status(client):
    t = _create_task(client)
    _start_run(client, t["id"])
    _upsert_plan(client, t["id"], [
        {"id": "p1", "name": "Setup", "description": "Init"},
    ])

    r = client.patch(f"/tasks/{t['id']}/phase", json={
        "phase_id": "p1",
        "status": "running",
    })
    assert r.status_code == 200
    assert r.json()["plan"]["phases"][0]["status"] == "running"

    r = client.patch(f"/tasks/{t['id']}/phase", json={
        "phase_id": "p1",
        "status": "completed",
        "summary": "Setup complete",
    })
    assert r.status_code == 200
    phase = r.json()["plan"]["phases"][0]
    assert phase["status"] == "completed"
    assert phase["summary"] == "Setup complete"


def test_update_phase_with_child_run_id(client):
    t = _create_task(client)
    _start_run(client, t["id"])
    _upsert_plan(client, t["id"], [
        {"id": "p1", "name": "Build", "description": "Build phase"},
    ])

    child_run_id = _hex_id()
    r = client.patch(f"/tasks/{t['id']}/phase", json={
        "phase_id": "p1",
        "status": "running",
        "child_run_id": child_run_id,
    })
    assert r.status_code == 200
    assert r.json()["plan"]["phases"][0]["child_run_id"] == child_run_id


def test_update_phase_not_in_plan(client):
    t = _create_task(client)
    _start_run(client, t["id"])
    _upsert_plan(client, t["id"], [
        {"id": "p1", "name": "Setup", "description": "Init"},
    ])

    r = client.patch(f"/tasks/{t['id']}/phase", json={
        "phase_id": "nonexistent",
        "status": "running",
    })
    assert r.status_code == 404
    assert "not in plan" in r.json()["detail"]


def test_update_phase_no_plan(client):
    t = _create_task(client)
    r = client.patch(f"/tasks/{t['id']}/phase", json={
        "phase_id": "p1",
        "status": "running",
    })
    assert r.status_code == 400
    assert "Plan not set" in r.json()["detail"]


# ═══════════════════════════════════════════════════════════════════
#  5. Event persistence
# ═══════════════════════════════════════════════════════════════════


def test_append_events(client):
    t = _create_task(client)
    events = [
        {"seq": 0, "kind": "text_delta", "payload_json": '{"text":"hello"}'},
        {"seq": 1, "kind": "tool_start", "payload_json": '{"tool":"search"}'},
    ]
    r = client.post(f"/tasks/{t['id']}/events", json={"events": events})
    assert r.status_code == 201
    assert r.json()["created"] == 2

    # List them back
    r = client.get(f"/tasks/{t['id']}/events")
    assert r.status_code == 200
    evts = r.json()
    assert len(evts) == 2
    assert evts[0]["seq"] == 0
    assert evts[1]["seq"] == 1
    assert evts[0]["kind"] == "text_delta"


def test_event_dedup(client):
    t = _create_task(client)
    events = [
        {"seq": 0, "kind": "text_delta", "payload_json": '{"text":"first"}'},
    ]
    r = client.post(f"/tasks/{t['id']}/events", json={"events": events})
    assert r.json()["created"] == 1

    # Re-send same seq 0 plus a new seq 1
    events2 = [
        {"seq": 0, "kind": "text_delta", "payload_json": '{"text":"duplicate"}'},
        {"seq": 1, "kind": "text_delta", "payload_json": '{"text":"new"}'},
    ]
    r = client.post(f"/tasks/{t['id']}/events", json={"events": events2})
    assert r.json()["created"] == 1  # only seq 1 was new

    # Total should be 2
    r = client.get(f"/tasks/{t['id']}/events")
    assert len(r.json()) == 2


def test_events_after_seq(client):
    t = _create_task(client)
    events = [
        {"seq": 0, "kind": "text_delta", "payload_json": '{"text":"a"}'},
        {"seq": 1, "kind": "text_delta", "payload_json": '{"text":"b"}'},
        {"seq": 2, "kind": "text_delta", "payload_json": '{"text":"c"}'},
    ]
    client.post(f"/tasks/{t['id']}/events", json={"events": events})

    # Get events after seq 0
    r = client.get(f"/tasks/{t['id']}/events", params={"after_seq": 0})
    evts = r.json()
    assert len(evts) == 2
    assert evts[0]["seq"] == 1
    assert evts[1]["seq"] == 2


def test_events_with_limit(client):
    t = _create_task(client)
    events = [
        {"seq": i, "kind": "text_delta", "payload_json": f'{{"i":{i}}}'}
        for i in range(5)
    ]
    client.post(f"/tasks/{t['id']}/events", json={"events": events})

    r = client.get(f"/tasks/{t['id']}/events", params={"limit": 2})
    assert len(r.json()) == 2


def test_append_events_task_not_found(client):
    r = client.post("/tasks/nonexistent/events", json={"events": []})
    assert r.status_code == 404


# ═══════════════════════════════════════════════════════════════════
#  6. Cancellation
# ═══════════════════════════════════════════════════════════════════


def test_cancel_running_task(client):
    t = _create_task(client)
    _start_run(client, t["id"])

    r = client.post(f"/tasks/{t['id']}/cancel")
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "cancelled"
    assert body["completed_at"] is not None


def test_cancel_idempotent_on_terminal(client):
    """Cancelling an already-completed task does not change its status."""
    t = _create_task(client)
    _start_run(client, t["id"])
    _finalize(client, t["id"], status="completed")

    r = client.post(f"/tasks/{t['id']}/cancel")
    assert r.status_code == 200
    assert r.json()["status"] == "completed"  # unchanged


def test_cancel_already_cancelled(client):
    t = _create_task(client)
    _start_run(client, t["id"])

    client.post(f"/tasks/{t['id']}/cancel")
    r = client.post(f"/tasks/{t['id']}/cancel")
    assert r.status_code == 200
    assert r.json()["status"] == "cancelled"


def test_cancel_pending_task(client):
    t = _create_task(client)
    r = client.post(f"/tasks/{t['id']}/cancel")
    assert r.status_code == 200
    assert r.json()["status"] == "cancelled"


def test_cancel_task_not_found(client):
    r = client.post("/tasks/nonexistent/cancel")
    assert r.status_code == 404


# ═══════════════════════════════════════════════════════════════════
#  7. Follow-up
# ═══════════════════════════════════════════════════════════════════


def test_follow_up_on_completed_task(client):
    t = _create_task(client, goal="Build a dashboard")
    _start_run(client, t["id"])
    _finalize(client, t["id"], status="completed", deliverable_markdown="# Dashboard v1")

    r = client.post(f"/tasks/{t['id']}/follow-up", json={
        "instruction": "Add dark mode",
    })
    assert r.status_code == 200
    body = r.json()
    assert body["task_id"] == t["id"]
    assert body["run_id"]
    assert body["conversation_id"]
    assert "Build a dashboard" in body["follow_up_context"]
    assert "Dashboard v1" in body["follow_up_context"]

    # Task should be back to running
    detail = client.get(f"/tasks/{t['id']}").json()
    assert detail["status"] == "running"


def test_follow_up_on_failed_task(client):
    t = _create_task(client)
    _start_run(client, t["id"])
    _finalize(client, t["id"], status="failed", error="OOM")

    r = client.post(f"/tasks/{t['id']}/follow-up", json={
        "instruction": "Try again with less memory",
    })
    assert r.status_code == 200
    body = r.json()
    assert body["task_id"] == t["id"]

    # Error should be cleared
    detail = client.get(f"/tasks/{t['id']}").json()
    assert detail["status"] == "running"
    assert detail["error"] is None


def test_follow_up_on_cancelled_task(client):
    t = _create_task(client)
    _start_run(client, t["id"])
    client.post(f"/tasks/{t['id']}/cancel")

    r = client.post(f"/tasks/{t['id']}/follow-up", json={
        "instruction": "Resume the task",
    })
    assert r.status_code == 200
    assert r.json()["task_id"] == t["id"]


def test_follow_up_rejected_on_running_task(client):
    t = _create_task(client)
    _start_run(client, t["id"])

    r = client.post(f"/tasks/{t['id']}/follow-up", json={
        "instruction": "Should fail",
    })
    assert r.status_code == 400
    assert "terminal" in r.json()["detail"]


def test_follow_up_not_found(client):
    r = client.post("/tasks/nonexistent/follow-up", json={
        "instruction": "Nope",
    })
    assert r.status_code == 404


# ═══════════════════════════════════════════════════════════════════
#  8. Finalization variants
# ═══════════════════════════════════════════════════════════════════


def test_finalize_completed_with_deliverable(client):
    t = _create_task(client)
    _start_run(client, t["id"])

    resp = _finalize(
        client,
        t["id"],
        status="completed",
        deliverable_markdown="# Final Output\n\nHere is your dashboard.",
        deliverable_title="Dashboard v1",
        deliverable_kind="code_app",
    )
    assert resp["status"] == "completed"
    assert resp["deliverable_markdown"] == "# Final Output\n\nHere is your dashboard."
    assert resp["deliverable_title"] == "Dashboard v1"
    assert resp["deliverable_kind"] == "code_app"
    assert resp["completed_at"] is not None


def test_finalize_failed_with_error(client):
    t = _create_task(client)
    _start_run(client, t["id"])

    resp = _finalize(
        client,
        t["id"],
        status="failed",
        error="Build failed: dependency not found",
    )
    assert resp["status"] == "failed"
    assert resp["error"] == "Build failed: dependency not found"
    assert resp["completed_at"] is not None


def test_finalize_with_run_info(client):
    t = _create_task(client)
    _start_run(client, t["id"])

    run_info = {
        "preview_type": "web",
        "setup_commands": ["npm install"],
        "start_command": "npm run dev",
        "preview_url_pattern": "http://localhost:3000",
    }
    resp = _finalize(
        client,
        t["id"],
        status="completed",
        deliverable_kind="code_app",
        run_info=run_info,
    )
    assert resp["run_info"] is not None
    assert resp["run_info"]["preview_type"] == "web"
    assert resp["run_info"]["start_command"] == "npm run dev"
    assert resp["run_info"]["setup_commands"] == ["npm install"]


def test_finalize_with_created_expert_ids(client):
    t = _create_task(client)
    _start_run(client, t["id"])

    resp = _finalize(
        client,
        t["id"],
        status="completed",
        created_expert_ids=["expert_1", "expert_2"],
    )
    assert resp["created_expert_ids"] == ["expert_1", "expert_2"]


def test_finalize_task_not_found(client):
    r = client.post("/tasks/nonexistent/finalize", json={"status": "completed"})
    assert r.status_code == 404


# ═══════════════════════════════════════════════════════════════════
#  9. Workspace
# ═══════════════════════════════════════════════════════════════════


def test_workspace_tree_after_run(client):
    t = _create_task(client)
    run_resp = _start_run(client, t["id"])
    workspace = run_resp["workspace_path"]

    # Create a file in the workspace
    os.makedirs(os.path.join(workspace, "src"), exist_ok=True)
    with open(os.path.join(workspace, "src", "main.ts"), "w") as f:
        f.write("console.log('hello');")

    r = client.get(f"/tasks/{t['id']}/workspace/tree")
    assert r.status_code == 200
    body = r.json()
    assert body["truncated"] is False
    paths = [e["path"] for e in body["files"]]
    assert "src" in paths
    assert "src/main.ts" in paths


def test_workspace_read_file(client):
    t = _create_task(client)
    run_resp = _start_run(client, t["id"])
    workspace = run_resp["workspace_path"]

    with open(os.path.join(workspace, "readme.md"), "w") as f:
        f.write("# Hello World")

    r = client.get(f"/tasks/{t['id']}/workspace/file", params={"path": "readme.md"})
    assert r.status_code == 200
    body = r.json()
    assert body["content"] == "# Hello World"
    assert body["path"] == "readme.md"
    assert body["language"] == "markdown"


def test_workspace_read_file_not_found(client):
    t = _create_task(client)
    _start_run(client, t["id"])

    r = client.get(f"/tasks/{t['id']}/workspace/file", params={"path": "nope.txt"})
    assert r.status_code == 404


def test_workspace_tree_no_workspace(client):
    t = _create_task(client)
    # No run started => no workspace
    r = client.get(f"/tasks/{t['id']}/workspace/tree")
    assert r.status_code == 404


def test_workspace_preview_file(client):
    t = _create_task(client)
    run_resp = _start_run(client, t["id"])
    workspace = run_resp["workspace_path"]

    with open(os.path.join(workspace, "index.html"), "w") as f:
        f.write("<html><body>Preview</body></html>")

    r = client.get(f"/tasks/{t['id']}/workspace/preview-file")
    assert r.status_code == 200
    body = r.json()
    assert body["found"] is True
    assert body["path"] == "index.html"
    assert "Preview" in body["content"]


def test_workspace_preview_file_not_found(client):
    t = _create_task(client)
    run_resp = _start_run(client, t["id"])
    # Empty workspace, no HTML files

    r = client.get(f"/tasks/{t['id']}/workspace/preview-file")
    assert r.status_code == 200
    body = r.json()
    assert body["found"] is False


def test_workspace_preview_file_no_workspace(client):
    t = _create_task(client)
    # No run started => no workspace
    r = client.get(f"/tasks/{t['id']}/workspace/preview-file")
    assert r.status_code == 200
    body = r.json()
    assert body["found"] is False


# ═══════════════════════════════════════════════════════════════════
#  10. Validation
# ═══════════════════════════════════════════════════════════════════


def test_missing_task_404(client):
    assert client.get("/tasks/missing_id").status_code == 404
    assert client.post("/tasks/missing_id/run", json={"phase": "execute"}).status_code == 404
    assert client.post("/tasks/missing_id/plan", json={"phases": []}).status_code == 404
    assert client.patch("/tasks/missing_id/phase", json={
        "phase_id": "p1", "status": "running"
    }).status_code == 404
    assert client.post("/tasks/missing_id/finalize", json={
        "status": "completed"
    }).status_code == 404
    assert client.post("/tasks/missing_id/clarify", json={
        "answers": []
    }).status_code == 404
    assert client.post("/tasks/missing_id/clarifications", json={
        "questions": []
    }).status_code == 404


def test_empty_title_becomes_untitled(client):
    """An empty title is replaced with 'Untitled task'."""
    t = _create_task(client, title="", goal="Some goal")
    assert t["title"] == "Untitled task"


def test_whitespace_title_becomes_untitled(client):
    t = _create_task(client, title="   ", goal="Some goal")
    assert t["title"] == "Untitled task"


def test_max_turns_clamped_low(client):
    t = _create_task(client, max_turns=1)
    assert t["max_turns"] == 5  # clamped to minimum 5


def test_max_turns_clamped_high(client):
    t = _create_task(client, max_turns=999)
    assert t["max_turns"] == 200  # clamped to maximum 200


def test_max_phases_clamped_low(client):
    t = _create_task(client, max_phases=0)
    assert t["max_phases"] == 1  # clamped to minimum 1


def test_max_phases_clamped_high(client):
    t = _create_task(client, max_phases=50)
    assert t["max_phases"] == 12  # clamped to maximum 12


# ═══════════════════════════════════════════════════════════════════
#  11. Delete cascade
# ═══════════════════════════════════════════════════════════════════


def test_delete_cascade_cleans_workspace(client):
    t = _create_task(client)
    run_resp = _start_run(client, t["id"])
    workspace = run_resp["workspace_path"]

    # Create a file in workspace
    with open(os.path.join(workspace, "test.txt"), "w") as f:
        f.write("data")
    assert os.path.isdir(workspace)

    # Delete the task
    r = client.delete(f"/tasks/{t['id']}")
    assert r.status_code == 204

    # Workspace directory should be gone
    assert not os.path.exists(workspace)


def test_delete_cascade_removes_run(client):
    t = _create_task(client)
    run_resp = _start_run(client, t["id"])
    run_id = run_resp["run_id"]

    # Run should be "running" before delete
    r = client.get(f"/engine/runs/{run_id}")
    assert r.status_code == 200
    assert r.json()["status"] == "running"

    # Delete the task
    client.delete(f"/tasks/{t['id']}")

    # The run record cascades with the task
    r = client.get(f"/engine/runs/{run_id}")
    assert r.status_code == 404


def test_delete_cascade_events_gone(client):
    t = _create_task(client)
    events = [
        {"seq": 0, "kind": "text_delta", "payload_json": '{"text":"data"}'},
    ]
    client.post(f"/tasks/{t['id']}/events", json={"events": events})

    # Verify events exist
    r = client.get(f"/tasks/{t['id']}/events")
    assert len(r.json()) == 1

    # Delete the task
    client.delete(f"/tasks/{t['id']}")

    # Task is gone, events endpoint returns 404 (task not found for GET)
    # or empty (events were cascade-deleted in DB)
    # The list_events endpoint doesn't check task existence — it just queries by task_id
    r = client.get(f"/tasks/{t['id']}/events")
    assert len(r.json()) == 0


# ═══════════════════════════════════════════════════════════════════
#  12. Edge cases / additional coverage
# ═══════════════════════════════════════════════════════════════════


def test_run_creates_conversation_and_workspace(client):
    """Starting a run on a pending task creates a conversation and workspace."""
    t = _create_task(client)
    assert t["conversation_id"] is None
    assert t["workspace_path"] is None

    run_resp = _start_run(client, t["id"])
    assert run_resp["conversation_id"]
    assert run_resp["workspace_path"]
    assert os.path.isdir(run_resp["workspace_path"])


def test_run_mints_fresh_ids_per_phase(client):
    """Each phase mints its own tracking id and run record (tasks are independent of conversations)."""
    t = _create_task(client)
    r1 = _start_run(client, t["id"], phase="clarify")
    r2 = _start_run(client, t["id"], phase="execute")
    assert r1["conversation_id"] != r2["conversation_id"]
    assert r1["run_id"] != r2["run_id"]


def test_plan_upsert_sets_running_status(client):
    """Upserting a plan on a non-terminal task sets status to running."""
    t = _create_task(client)
    _start_run(client, t["id"], phase="clarify")

    resp = _upsert_plan(client, t["id"], [
        {"id": "p1", "name": "Only Phase", "description": "Do it"},
    ])
    assert resp["status"] == "running"


def test_plan_upsert_preserves_terminal_status(client):
    """Upserting a plan on a completed task does not change status."""
    t = _create_task(client)
    _start_run(client, t["id"])
    _finalize(client, t["id"], status="completed")

    resp = _upsert_plan(client, t["id"], [
        {"id": "p1", "name": "Late Plan", "description": "After done"},
    ])
    assert resp["status"] == "completed"


def test_clarification_answers_block_format(client):
    """answers_block formats boolean and string answers correctly."""
    t = _create_task(client)
    _start_run(client, t["id"], phase="clarify")

    questions = [
        {"id": "q1", "q": "Use TypeScript?", "kind": "bool"},
        {"id": "q2", "q": "Framework?", "kind": "text"},
    ]
    _set_clarifications(client, t["id"], questions)

    resp = _submit_answers(client, t["id"], [
        {"id": "q1", "answer": False},
        {"id": "q2", "answer": "Next.js"},
    ])
    assert "no" in resp["answers_block"]
    assert "Next.js" in resp["answers_block"]
    assert "Use TypeScript?" in resp["answers_block"]
    assert "Framework?" in resp["answers_block"]


def test_follow_up_includes_clarification_context(client):
    """Follow-up context includes previously submitted clarification answers."""
    t = _create_task(client, goal="Build an app")
    _start_run(client, t["id"], phase="clarify")

    questions = [{"id": "q1", "q": "What framework?", "kind": "text"}]
    _set_clarifications(client, t["id"], questions)
    _submit_answers(client, t["id"], [{"id": "q1", "answer": "React"}])

    _start_run(client, t["id"], phase="execute")
    _finalize(client, t["id"], status="completed", deliverable_markdown="# v1")

    r = client.post(f"/tasks/{t['id']}/follow-up", json={
        "instruction": "Add tests",
    })
    body = r.json()
    assert "React" in body["follow_up_context"]
    assert "What framework?" in body["follow_up_context"]


def test_get_task_detail_with_run(client):
    """GET /tasks/{id} includes run record when task has been started."""
    t = _create_task(client)
    run_resp = _start_run(client, t["id"])

    detail = client.get(f"/tasks/{t['id']}").json()
    assert detail["run"] is not None
    assert detail["run"]["id"] == run_resp["run_id"]
    assert detail["run"]["status"] == "running"
    assert detail["run"]["run_type"] == "task"


def test_finalize_marks_run_completed(client):
    """Finalizing a task also closes its run record."""
    t = _create_task(client)
    run_resp = _start_run(client, t["id"])

    _finalize(client, t["id"], status="completed")

    r = client.get(f"/engine/runs/{run_resp['run_id']}")
    run = r.json()
    assert run["status"] == "completed"
    assert run["completed_at"] is not None


def test_finalize_failed_marks_run_failed(client):
    t = _create_task(client)
    run_resp = _start_run(client, t["id"])

    _finalize(client, t["id"], status="failed", error="Out of memory")

    r = client.get(f"/engine/runs/{run_resp['run_id']}")
    run = r.json()
    assert run["status"] == "failed"
    assert run["error"] == "Out of memory"


def test_workspace_path_traversal_rejected(client):
    """Trying to read a file with path traversal should fail."""
    t = _create_task(client)
    _start_run(client, t["id"])

    r = client.get(f"/tasks/{t['id']}/workspace/file", params={"path": "../../etc/passwd"})
    assert r.status_code == 400
