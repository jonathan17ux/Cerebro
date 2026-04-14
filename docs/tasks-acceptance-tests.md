# Tasks Feature — Acceptance Test Plan

This document defines manual acceptance tests for the Cerebro Tasks feature.
Each test has clear preconditions, steps, and expected results. Tests are grouped
by functional area and ordered so earlier tests validate foundations that later
tests depend on.

---

## Prerequisites

- Cerebro app running (`npm start`)
- Claude Code CLI installed and detected (Settings > Integrations shows green)
- At least one cloud provider API key configured (Anthropic recommended)
- DevTools console open (Cmd+Option+I) to observe diagnostic logs

---

## 1. Task Creation

### TC-1.1 Create a task with default settings
**Steps:**
1. Navigate to Tasks screen
2. Click "+ New Task" button
3. Type "Write a haiku about the ocean" in the goal textarea
4. Click "Start Task"

**Expected:**
- Task appears in the left sidebar list with status "Running" (yellow dot)
- Task detail panel opens on the right
- Console tab is selected by default
- Timer shows elapsed time counting up (e.g., "Running  3s")

### TC-1.2 Create a task with Cmd+Enter
**Steps:**
1. Open New Task dialog
2. Type any goal
3. Press Cmd+Enter (or Ctrl+Enter on non-Mac)

**Expected:**
- Task is submitted (same as clicking "Start Task")

### TC-1.3 Create a task with a template selected
**Steps:**
1. Open New Task dialog
2. Type "Make a landing page for a coffee shop"
3. Click the "Web App" template chip (should highlight)
4. Click "Start Task"

**Expected:**
- Task is created and starts running
- Template chip was visually selected (cyan highlight) before submit
- Clicking the same template again deselects it

### TC-1.4 Create a task with advanced settings
**Steps:**
1. Open New Task dialog
2. Type any goal
3. Click "Advanced" to expand
4. Select "Opus" model
5. Drag Max Turns slider to 50
6. Drag Max Phases slider to 8
7. Start the task

**Expected:**
- Task runs with the selected model (visible in main process logs: `--model opus`)
- Main process log shows `--max-turns 50`

### TC-1.5 Empty goal is rejected
**Steps:**
1. Open New Task dialog
2. Leave goal empty
3. Observe the "Start Task" button

**Expected:**
- Button is disabled (grayed out, cursor not-allowed)
- Pressing Cmd+Enter does nothing

### TC-1.6 Cancel dialog with Escape
**Steps:**
1. Open New Task dialog
2. Type something in goal
3. Press Escape

**Expected:**
- Dialog closes
- No task is created
- Goal text is cleared (if reopened, textarea is empty)

### TC-1.7 Initial goal pre-fill
**Steps:**
1. If a suggestion chip or external trigger opens the dialog with a pre-filled goal

**Expected:**
- Goal textarea shows the pre-filled text
- User can edit before submitting

---

## 2. Console Tab — Terminal Output

### TC-2.1 Terminal appears immediately on task start
**Steps:**
1. Create a new task (any simple goal)
2. Observe the Console tab

**Expected:**
- Black terminal area is visible immediately (xterm.js canvas)
- Within 2-3 seconds, Claude Code output starts appearing (ANSI-colored text, spinners, tool boxes)
- DevTools console shows: `[TaskContext] Global PTY data #1: runId=..., N bytes`
- Main process console shows: `[TaskPtyRunner] Spawning: ...` and `[PTY→IPC] chunk #1 ...`

### TC-2.2 Terminal shows real ANSI colors
**Steps:**
1. While a task is running, observe the Console tab

**Expected:**
- Output includes colored text (cyan, green, yellow, etc.)
- Tool call boxes render with borders
- Spinner animations work (not static characters)
- Output looks identical to running `claude -p` in a real terminal

### TC-2.3 Terminal scrolls with output
**Steps:**
1. Run a task that produces lots of output (e.g., "Build a web app with React")
2. Let it run until output exceeds the visible area

**Expected:**
- Terminal auto-scrolls to show newest output
- Scroll-to-bottom button appears when manually scrolled up
- Clicking the scroll button jumps to the bottom

### TC-2.4 Terminal resizes correctly
**Steps:**
1. While a task is running, resize the Cerebro window (drag edges)
2. Make it wider, narrower, taller, shorter

**Expected:**
- Terminal content reflows to fit new dimensions
- No blank gaps or overlapping text
- Claude Code output wraps correctly at new width

### TC-2.5 Terminal persists when switching tabs
**Steps:**
1. While a task is running, click "Plan" tab
2. Click back to "Console" tab

**Expected:**
- Terminal content is preserved (all previous output still visible)
- New output continues to appear
- No duplication of content

### TC-2.6 Terminal shows output for completed task
**Steps:**
1. Wait for a task to complete successfully
2. Click on it in the sidebar
3. Click "Console" tab

**Expected:**
- Terminal shows the text_delta replay of the session
- Not an empty terminal

---

## 3. Task Execution Lifecycle

### TC-3.1 Task completes successfully (markdown)
**Steps:**
1. Create task: "Write a 3-paragraph essay about space exploration"
2. Wait for completion

**Expected:**
- Status transitions: Running → Completed (green dot)
- Timer shows final elapsed time
- Deliverable tab shows rendered markdown
- Plan tab shows phases (if Claude emitted a plan)

### TC-3.2 Task completes successfully (code_app)
**Steps:**
1. Create task: "Build a simple HTML page with a button that counts clicks"
2. Wait for completion

**Expected:**
- Status: Completed
- Deliverable tab shows code description
- Preview tab appears (either static HTML preview or dev server)
- Workspace tab shows created files (index.html, etc.)

### TC-3.3 Task fails gracefully
**Steps:**
1. Create task with max turns set to 5 (via Advanced): "Build a complete e-commerce website with authentication and payment processing"
2. Wait for it to hit the turn limit

**Expected:**
- Status transitions to Failed (red dot)
- Error message visible: "Claude Code exited with code N"
- Console tab shows the output up to the failure point
- Any partial deliverable is preserved
- Task can still be inspected (Plan, Console, Workspace tabs still work)

### TC-3.4 Task cancellation
**Steps:**
1. Create a task that will run for a while
2. While it's running (status: Running), click the Cancel button (X icon)

**Expected:**
- Status transitions to Cancelled
- Console shows output up to cancellation point
- Timer stops
- No error message (cancellation is intentional, not a failure)
- Main process log shows: `[TaskPtyRunner] Process exited: ... killed=true`

### TC-3.5 Multiple concurrent tasks
**Steps:**
1. Create task A: "Write a poem about mountains"
2. Immediately create task B: "Write a poem about rivers"
3. Observe both in the sidebar

**Expected:**
- Both show "Running" status simultaneously
- Clicking each shows its own console output (independent terminals)
- Each completes independently
- No cross-contamination of output between tasks

---

## 4. Plan Tab

### TC-4.1 Plan appears during execution
**Steps:**
1. Create a task that requires multiple phases (e.g., "Build an HTML presentation about AI trends with 5 slides, custom CSS, and animations")
2. Observe the Plan tab during execution

**Expected:**
- Plan tab populates with phase list after Claude emits `<plan>` tag
- Each phase shows: name, status icon (pending/running/completed)
- Active phase is visually distinct (highlighted or animated)
- Deliverable kind badge visible (markdown / code_app / mixed)

### TC-4.2 Phase status updates live
**Steps:**
1. During a multi-phase task, watch the Plan tab

**Expected:**
- Phases transition: pending → running → completed
- Phase summaries appear inline after each phase completes
- Only one phase is "running" at a time

---

## 5. Deliverable Tab

### TC-5.1 Markdown deliverable renders
**Steps:**
1. Create task: "Write a research brief about renewable energy"
2. Wait for completion
3. Click "Deliverable" tab

**Expected:**
- Markdown content renders with proper formatting (headers, lists, bold, etc.)
- Prose is styled (readable line width, proper spacing)
- Code blocks (if any) are syntax-highlighted

### TC-5.2 Deliverable with run_info shows dev server controls
**Steps:**
1. Create task: "Build a Next.js hello world app"
2. Wait for completion
3. Click "Deliverable" tab

**Expected:**
- Run info section visible (setup commands, start command)
- Dev server controls available (Start/Stop buttons)

### TC-5.3 No deliverable for in-progress task
**Steps:**
1. While a task is still running, click "Deliverable" tab

**Expected:**
- Shows placeholder or "Deliverable will appear when the task completes"
- No broken/partial markdown

---

## 6. Preview Tab

### TC-6.1 Static HTML preview
**Steps:**
1. Create task: "Create a single index.html file with a styled hello world page"
2. Wait for completion
3. Click "Preview" tab

**Expected:**
- Preview tab is visible (for code_app or mixed deliverables)
- Iframe shows the rendered HTML page
- Page is interactive (can click buttons, etc.)

### TC-6.2 Dev server preview
**Steps:**
1. Create task: "Build a React app with Vite that shows a counter"
2. Wait for completion
3. Click "Preview" tab

**Expected:**
- Dev server starts automatically (or has Start button)
- Status indicator shows server starting → running
- Iframe loads the running app
- HMR updates would be visible if files changed

### TC-6.3 Live preview during execution
**Steps:**
1. Create a task that generates HTML files
2. Switch to Preview tab while task is still running

**Expected:**
- If no files yet: "Watching for content..." placeholder
- As HTML files are created: preview appears and updates
- Polling indicator visible during active monitoring

---

## 7. Workspace Tab

### TC-7.1 Workspace file tree
**Steps:**
1. Complete a code_app task
2. Click "Workspace" tab

**Expected:**
- File tree shows all created files
- node_modules, .git, etc. are excluded
- Directories are expandable/collapsible

### TC-7.2 File content preview
**Steps:**
1. In Workspace tab, click on a source file (e.g., index.html)

**Expected:**
- File content displays with syntax highlighting
- Language is auto-detected
- Large files show truncation notice

### TC-7.3 Reveal workspace in Finder
**Steps:**
1. If "Reveal in Finder" button exists, click it

**Expected:**
- Opens macOS Finder at the workspace directory
- Workspace contains the files shown in the tree

---

## 8. Task Deletion

### TC-8.1 Delete a completed task
**Steps:**
1. Select a completed task
2. Click delete button
3. Confirm deletion

**Expected:**
- Task removed from sidebar list
- Workspace directory cleaned up
- Selection moves to another task or empty state

### TC-8.2 Delete a failed task
**Steps:**
1. Select a failed task
2. Delete it

**Expected:**
- Same as TC-8.1

---

## 9. Clarification Flow

### TC-9.1 Clarification questions (skip disabled)
**Precondition:** Create task dialog with "Skip Clarification" toggle OFF

**Steps:**
1. Open New Task dialog
2. Turn OFF the "Skip Clarification" toggle
3. Enter a vague goal: "Build me something cool"
4. Start the task

**Expected:**
- Status: Clarifying → Awaiting Clarification
- Clarification panel overlays the detail view
- Questions rendered (text inputs, dropdowns, etc.)
- User can type answers and submit

### TC-9.2 Submit clarification answers
**Steps:**
1. From TC-9.1, fill in answers to all questions
2. Click Submit

**Expected:**
- Status transitions to Running (execute phase begins)
- Console shows new Claude Code session starting
- Answers are incorporated into the execution context

### TC-9.3 Skip clarification (default)
**Steps:**
1. Create task with default settings (skip clarification is ON)

**Expected:**
- Task goes directly to Running (execute phase)
- No clarification questions shown
- Main process log shows `taskPhase: 'execute'`

---

## 10. Follow-Up

### TC-10.1 Follow-up on completed task
**Steps:**
1. Select a completed task
2. Type in the follow-up input: "Add a dark mode toggle"
3. Submit

**Expected:**
- Task status returns to Running
- Console shows new Claude Code session with context from previous run
- Workspace is reused (files from previous run still present)
- Claude has access to prior deliverable context

### TC-10.2 Follow-up preserves workspace
**Steps:**
1. Complete a code_app task that created files
2. Start a follow-up
3. After follow-up completes, check Workspace tab

**Expected:**
- Both original and follow-up files present
- Modified files show updated content
- No workspace corruption

---

## 11. Error Handling

### TC-11.1 Claude Code not installed
**Precondition:** Claude Code CLI not available (or rename binary temporarily)

**Steps:**
1. Create a task

**Expected:**
- Task fails immediately
- Error message indicates Claude Code is not available
- Main process log: PTY exit with code 1

### TC-11.2 Network error during event flush
**Steps:**
1. Start a task
2. Kill the Python backend mid-execution (simulate network failure)

**Expected:**
- Task may continue running (PTY is independent of backend)
- Event persistence fails silently (events re-queued)
- Task finalization may fail — user sees error state
- Restarting app should recover gracefully

### TC-11.3 Very long output
**Steps:**
1. Create task: "Generate a 500-line Python file with comprehensive unit tests"

**Expected:**
- Console handles large output without freezing
- Terminal scrollback works (10,000 lines max)
- Buffer doesn't exceed 512KB cap (older output truncated)

---

## 12. Reconnection / Navigation

### TC-12.1 Navigate away and back during execution
**Steps:**
1. Start a task
2. Navigate to a different screen (e.g., Settings)
3. Navigate back to Tasks
4. Click on the running task

**Expected:**
- Console shows all output from the beginning (buffer replay)
- Live output continues to appear
- No gap in output

### TC-12.2 Restart app during execution
**Steps:**
1. Start a long-running task
2. Quit and restart Cerebro

**Expected:**
- Running task is listed in sidebar (watchTask picks it up)
- Status shows "Running" if process is still alive
- Console may lose pre-restart buffer (expected — no disk persistence)
- Task eventually completes or times out

### TC-12.3 Select different task during execution
**Steps:**
1. Have two tasks — one running, one completed
2. Click between them rapidly

**Expected:**
- Console shows correct output for selected task
- No cross-contamination
- Running task's timer continues regardless of selection

---

## 13. Edge Cases

### TC-13.1 Unicode and special characters in goal
**Steps:**
1. Create task: "写一首关于月亮的诗 (Write a poem about the moon in Chinese)"

**Expected:**
- Task creates successfully
- Title derived correctly from goal
- Console shows Claude's output (may include Unicode)

### TC-13.2 Very long goal text
**Steps:**
1. Create task with a 2000+ character goal description

**Expected:**
- Task creates successfully
- Goal is passed to Claude without truncation
- No UI overflow in task detail header

### TC-13.3 Rapid task creation
**Steps:**
1. Create 5 tasks in quick succession (< 2 seconds between each)

**Expected:**
- All tasks appear in sidebar
- No crashes or duplicate IDs
- Each task has its own workspace
- Max concurrent runs (5) is respected — 6th should error

### TC-13.4 Task with no output
**Steps:**
1. If Claude Code exits immediately with code 0 (edge case)

**Expected:**
- Task marked as completed
- Console tab shows empty terminal (black screen, no error)
- Deliverable tab may show "no deliverable" or parser fallback

---

## Diagnostic Checklist

When any test fails, check these logs:

| Log Source | Where | What to Look For |
|------------|-------|------------------|
| `[TaskPtyRunner] Spawning:` | Main process terminal | PTY spawn command and args |
| `[TaskPtyRunner] PTY process spawned, pid=` | Main process terminal | PID confirms process started |
| `[TaskPtyRunner] Process exited:` | Main process terminal | Exit code, signal, killed flag |
| `[PTY→IPC] chunk #N` | Main process terminal | Data being sent to renderer |
| `[TaskContext] Setting up global PTY data subscription` | DevTools console | Global listener registered |
| `[TaskContext] Global PTY data #N` | DevTools console | Data arriving in renderer |
| Network tab | DevTools | POST /tasks, /tasks/{id}/run, /tasks/{id}/finalize |

---

## Test Priority

| Priority | Tests | Rationale |
|----------|-------|-----------|
| P0 — Blocking | TC-2.1, TC-3.1, TC-3.3, TC-3.4 | Core functionality: terminal must show output, tasks must complete or fail cleanly |
| P1 — Critical | TC-1.1, TC-2.2, TC-2.3, TC-3.2, TC-5.1, TC-6.1, TC-12.1 | Key user flows: creation, visual quality, deliverables, navigation |
| P2 — Important | TC-3.5, TC-4.1, TC-7.1, TC-9.1, TC-10.1, TC-11.3 | Multi-task, plan tracking, workspace, clarification, follow-up |
| P3 — Edge | TC-1.5, TC-1.6, TC-13.1-4, TC-11.1, TC-12.2 | Input validation, edge cases, error recovery |
