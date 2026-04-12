"""In-process dev-server registry.

Tasks with ``code_app`` or ``mixed`` deliverables can spawn a dev
server after completion. The registry owns the child process, scans
stdout for a URL, and exposes a WebSocket stream for the renderer.

**Runs outside sandbox-exec by design** — the Python backend spawns
these as its own children, not through ``wrapClaudeSpawn``. Dev servers
need long-lived outbound network + port binding that the task-execution
profile should not be authorizing. The webview ``will-navigate`` block
is the security boundary for dev-server output, not sandbox-exec.
"""

from __future__ import annotations

import asyncio
import os
import re
import shlex
import signal
import subprocess
import sys
import threading
from collections import deque
from datetime import datetime, timezone
from typing import Any

from fastapi import FastAPI, WebSocket, WebSocketDisconnect

from .schemas import RunInfo


_REGISTRY_KEY = "_task_dev_server_registry"
_STDOUT_TAIL_LINES = 500


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


class _DevServer:
    def __init__(self, task_id: str, workspace: str, run_info: RunInfo):
        self.task_id = task_id
        self.workspace = workspace
        self.run_info = run_info
        self.proc: subprocess.Popen | None = None
        self.started_at: datetime | None = None
        self.url: str | None = None
        self.stdout_tail: deque[str] = deque(maxlen=_STDOUT_TAIL_LINES)
        self.subscribers: list[asyncio.Queue[dict[str, Any]]] = []
        self._lock = threading.Lock()
        self._url_regex = (
            re.compile(run_info.preview_url_pattern)
            if run_info.preview_url_pattern
            else None
        )
        self._loop: asyncio.AbstractEventLoop | None = None

    def running(self) -> bool:
        return self.proc is not None and self.proc.poll() is None

    def _emit(self, event: dict[str, Any]) -> None:
        for q in list(self.subscribers):
            try:
                if self._loop is not None:
                    self._loop.call_soon_threadsafe(q.put_nowait, event)
                else:
                    q.put_nowait(event)
            except Exception:
                pass

    def _run_setup(self) -> bool:
        for cmd in self.run_info.setup_commands:
            self._emit({"kind": "setup_start", "cmd": cmd})
            try:
                result = subprocess.run(
                    cmd,
                    shell=True,
                    cwd=self.workspace,
                    capture_output=True,
                    text=True,
                    timeout=600,
                )
            except subprocess.TimeoutExpired:
                self._emit({"kind": "error", "message": f"setup timeout: {cmd}"})
                return False
            except Exception as exc:
                self._emit({"kind": "error", "message": f"setup error: {exc}"})
                return False
            if result.stdout:
                for line in result.stdout.splitlines():
                    self.stdout_tail.append(line)
                    self._emit({"kind": "stdout", "line": line})
            if result.stderr:
                for line in result.stderr.splitlines():
                    self.stdout_tail.append(line)
                    self._emit({"kind": "stderr", "line": line})
            if result.returncode != 0:
                self._emit(
                    {"kind": "error", "message": f"setup exit {result.returncode}: {cmd}"}
                )
                return False
            self._emit({"kind": "setup_done", "cmd": cmd})
        return True

    def _scan_output(self, stream, name: str) -> None:
        try:
            for raw in iter(stream.readline, b""):
                line = raw.decode("utf-8", errors="replace").rstrip("\r\n")
                self.stdout_tail.append(line)
                self._emit({"kind": name, "line": line})
                if self.url is None and self._url_regex is not None:
                    m = self._url_regex.search(line)
                    if m:
                        self.url = m.group(1) if m.groups() else m.group(0)
                        self._emit({"kind": "url_captured", "url": self.url})
        except Exception:
            pass
        finally:
            try:
                stream.close()
            except Exception:
                pass

    def start(self) -> int:
        with self._lock:
            if self.running():
                assert self.proc is not None
                return self.proc.pid

            try:
                self._loop = asyncio.get_running_loop()
            except RuntimeError:
                self._loop = None

            self._emit({"kind": "starting", "preview_type": self.run_info.preview_type})

            if not self._run_setup():
                raise RuntimeError("dev server setup failed")

            cmd = self.run_info.start_command
            # For cli preview_type we still spawn in background so stdout
            # can be streamed and "stop" behaves uniformly.
            try:
                popen_kwargs: dict[str, Any] = {
                    "cwd": self.workspace,
                    "stdout": subprocess.PIPE,
                    "stderr": subprocess.PIPE,
                    "stdin": subprocess.DEVNULL,
                    "shell": True,
                }
                if sys.platform != "win32":
                    popen_kwargs["start_new_session"] = True
                self.proc = subprocess.Popen(cmd, **popen_kwargs)
            except Exception as exc:
                self._emit({"kind": "error", "message": f"spawn failed: {exc}"})
                raise

            self.started_at = _utcnow()
            self._emit({"kind": "spawned", "pid": self.proc.pid})

            threading.Thread(
                target=self._scan_output,
                args=(self.proc.stdout, "stdout"),
                daemon=True,
            ).start()
            threading.Thread(
                target=self._scan_output,
                args=(self.proc.stderr, "stderr"),
                daemon=True,
            ).start()
            threading.Thread(
                target=self._wait_exit,
                daemon=True,
            ).start()

            return self.proc.pid

    def _wait_exit(self) -> None:
        if self.proc is None:
            return
        try:
            code = self.proc.wait()
        except Exception:
            code = -1
        self._emit({"kind": "exited", "code": code})

    def stop(self) -> bool:
        with self._lock:
            if not self.running():
                return False
            assert self.proc is not None
            try:
                if sys.platform != "win32":
                    os.killpg(os.getpgid(self.proc.pid), signal.SIGTERM)
                else:
                    self.proc.terminate()
            except Exception:
                try:
                    self.proc.terminate()
                except Exception:
                    pass

            def _force_kill():
                try:
                    if self.proc and self.proc.poll() is None:
                        if sys.platform != "win32":
                            os.killpg(os.getpgid(self.proc.pid), signal.SIGKILL)
                        else:
                            self.proc.kill()
                except Exception:
                    pass

            t = threading.Timer(3.0, _force_kill)
            t.daemon = True
            t.start()
            self._emit({"kind": "stopped"})
            return True

    def snapshot(self) -> dict[str, Any]:
        return {
            "running": self.running(),
            "pid": self.proc.pid if self.proc else None,
            "url": self.url,
            "started_at": self.started_at,
            "stdout_tail": "\n".join(self.stdout_tail) if self.stdout_tail else None,
            "preview_type": self.run_info.preview_type,
        }


class DevServerRegistry:
    def __init__(self) -> None:
        self._servers: dict[str, _DevServer] = {}
        self._lock = threading.Lock()

    def start(self, task_id: str, workspace: str, run_info: RunInfo) -> int:
        with self._lock:
            existing = self._servers.get(task_id)
            if existing and existing.running():
                existing.stop()
            server = _DevServer(task_id, workspace, run_info)
            self._servers[task_id] = server
        return server.start()

    def stop(self, task_id: str) -> bool:
        with self._lock:
            server = self._servers.get(task_id)
        if not server:
            return False
        return server.stop()

    def status(self, task_id: str) -> dict[str, Any] | None:
        with self._lock:
            server = self._servers.get(task_id)
        if not server:
            return None
        return server.snapshot()

    def subscribe(self, task_id: str) -> asyncio.Queue[dict[str, Any]] | None:
        with self._lock:
            server = self._servers.get(task_id)
        if not server:
            return None
        q: asyncio.Queue[dict[str, Any]] = asyncio.Queue(maxsize=1000)
        server.subscribers.append(q)
        # Seed the queue with the current tail so the subscriber can catch up
        for line in list(server.stdout_tail)[-50:]:
            try:
                q.put_nowait({"kind": "stdout", "line": line})
            except asyncio.QueueFull:
                break
        if server.url:
            try:
                q.put_nowait({"kind": "url_captured", "url": server.url})
            except asyncio.QueueFull:
                pass
        return q

    def unsubscribe(self, task_id: str, queue: asyncio.Queue) -> None:
        with self._lock:
            server = self._servers.get(task_id)
        if server and queue in server.subscribers:
            server.subscribers.remove(queue)

    def stop_all(self) -> None:
        with self._lock:
            servers = list(self._servers.values())
        for server in servers:
            try:
                server.stop()
            except Exception:
                pass


def get_registry(app: FastAPI) -> DevServerRegistry:
    reg = getattr(app.state, _REGISTRY_KEY, None)
    if reg is None:
        reg = DevServerRegistry()
        setattr(app.state, _REGISTRY_KEY, reg)
    return reg


# ── WebSocket stream endpoint ────────────────────────────────────


async def dev_server_stream(ws: WebSocket, task_id: str) -> None:
    await ws.accept()
    registry = get_registry(ws.app)
    queue = registry.subscribe(task_id)
    if queue is None:
        await ws.send_json({"kind": "error", "message": "dev server not running"})
        await ws.close()
        return
    try:
        while True:
            event = await queue.get()
            # Serialize datetimes
            if isinstance(event.get("started_at"), datetime):
                event = {**event, "started_at": event["started_at"].isoformat()}
            await ws.send_json(event)
            if event.get("kind") in ("stopped", "exited"):
                break
    except WebSocketDisconnect:
        pass
    except Exception:
        pass
    finally:
        registry.unsubscribe(task_id, queue)
        try:
            await ws.close()
        except Exception:
            pass
