/**
 * E2E Tests for Tasks Feature
 *
 * These tests connect to the RUNNING Cerebro app via Chrome DevTools
 * Protocol and exercise real tasks with Claude Code + Sonnet.
 *
 * Setup:
 *   1. Start Cerebro:  CEREBRO_E2E_DEBUG_PORT=9229 npm start
 *   2. Run tests:      npm run test:e2e
 *
 * Each test creates a real task, waits for completion, and verifies output.
 */

import { test, expect, type Browser, type Page } from '@playwright/test';
import { connectToApp, goToTasks, createTask, waitForTaskCompletion, verifyConsoleHasOutput, screenshot } from './helpers';

let browser: Browser;
let page: Page;

test.beforeAll(async () => {
  ({ browser, page } = await connectToApp());
});

test.afterAll(async () => {
  // Don't close — it's the user's running app
  await browser?.close();
});

test.beforeEach(async () => {
  await goToTasks(page);
});

// ─── Template: Presentation ───────────────────────────────────────

test('presentation template — creates HTML presentation', async () => {
  await createTask(page, {
    goal: 'Create a 3-slide HTML presentation about renewable energy with modern styling',
    templateId: 'presentation',
  });

  await screenshot(page, 'presentation-started');

  const hasOutput = await verifyConsoleHasOutput(page);
  expect(hasOutput).toBe(true);

  const status = await waitForTaskCompletion(page);
  await screenshot(page, 'presentation-done');

  expect(status).toBe('completed');
});

// ─── Template: Web App ────────────────────────────────────────────

test('web app template — builds interactive web page', async () => {
  await createTask(page, {
    goal: 'Build a single HTML page with a button that toggles dark mode',
    templateId: 'web-app',
  });

  await screenshot(page, 'webapp-started');

  const hasOutput = await verifyConsoleHasOutput(page);
  expect(hasOutput).toBe(true);

  const status = await waitForTaskCompletion(page);
  await screenshot(page, 'webapp-done');

  expect(status).toBe('completed');
});

// ─── Template: Research Brief ─────────────────────────────────────

test('research template — writes markdown research brief', async () => {
  await createTask(page, {
    goal: 'Write a 2-paragraph research brief about quantum computing advances in 2025',
    templateId: 'research',
  });

  await screenshot(page, 'research-started');

  const hasOutput = await verifyConsoleHasOutput(page);
  expect(hasOutput).toBe(true);

  const status = await waitForTaskCompletion(page);
  await screenshot(page, 'research-done');

  expect(status).toBe('completed');
});

// ─── Template: CLI Tool ───────────────────────────────────────────

test('cli tool template — creates a simple script', async () => {
  await createTask(page, {
    goal: 'Create a Python script that prints "Hello from Cerebro!" and the current date',
    templateId: 'cli-tool',
  });

  await screenshot(page, 'cli-started');

  const hasOutput = await verifyConsoleHasOutput(page);
  expect(hasOutput).toBe(true);

  const status = await waitForTaskCompletion(page);
  await screenshot(page, 'cli-done');

  expect(status).toBe('completed');
});

// ─── Template: Trip Plan ──────────────────────────────────────────

test('trip plan template — generates travel itinerary', async () => {
  await createTask(page, {
    goal: 'Plan a 1-day trip to a local park with a picnic lunch',
    templateId: 'trip-plan',
  });

  await screenshot(page, 'trip-started');

  const hasOutput = await verifyConsoleHasOutput(page);
  expect(hasOutput).toBe(true);

  const status = await waitForTaskCompletion(page);
  await screenshot(page, 'trip-done');

  expect(status).toBe('completed');
});

// ─── Template: Meal Plan ──────────────────────────────────────────

test('meal plan template — generates weekly meal plan', async () => {
  await createTask(page, {
    goal: 'Create a 3-day vegetarian meal plan with simple recipes',
    templateId: 'meal-plan',
  });

  await screenshot(page, 'meal-started');

  const hasOutput = await verifyConsoleHasOutput(page);
  expect(hasOutput).toBe(true);

  const status = await waitForTaskCompletion(page);
  await screenshot(page, 'meal-done');

  expect(status).toBe('completed');
});

// ─── Core behavior tests ─────────────────────────────────────────

test('console shows real terminal output immediately on task start', async () => {
  await createTask(page, {
    goal: 'Write a haiku about the ocean',
  });

  // Terminal should appear within 3 seconds
  await page.waitForTimeout(3000);

  const hasOutput = await verifyConsoleHasOutput(page);
  expect(hasOutput).toBe(true);

  await screenshot(page, 'console-immediate');

  await waitForTaskCompletion(page);
});

test('task cancellation works', async () => {
  await createTask(page, {
    goal: 'Build a complete e-commerce website with authentication, payment processing, and inventory management',
  });

  // Wait for task to start running
  await page.waitForTimeout(5000);

  // The cancel button is a Square icon in the task detail header.
  // It only appears for active (running/clarifying/planning) tasks.
  const cancelBtn = page.locator('button svg.lucide-square').locator('..');
  if (await cancelBtn.count() > 0) {
    await cancelBtn.first().click();
  }

  await page.waitForTimeout(3000);
  await screenshot(page, 'cancelled');

  // Check the detail panel status indicator (not the whole body which has "Running" filter tab)
  const detailHeader = page.locator('div.border-b:has(h2)');
  const statusSpan = detailHeader.locator('span:has(> span.rounded-full)');
  if (await statusSpan.count() > 0) {
    const statusText = await statusSpan.first().innerText();
    // Task should NOT show "Running" — should be Cancelled, Completed, or Failed
    expect(statusText).not.toMatch(/Running/i);
  }
});

// ─── Regression: re-run must not prematurely complete ────────────
//
// Repro for the "tasks prematurely marked to_review" bug. When a task is
// re-run via --resume, Claude Code's TUI re-renders the full prior
// conversation. That historical echo can contain a <deliverable> block,
// which — if scanned — falsely trips completion detection before the
// agent has done any new work. Verifies:
//   1. The first run actually finishes with a real deliverable (completes).
//   2. After clicking Re-run, the task re-enters Running state and STAYS
//      running for at least 10s (proving completion detection isn't
//      misfiring on the replayed history).
//   3. The re-run eventually completes with a fresh deliverable.

test('re-run does not prematurely mark task as done (resume regression)', async () => {
  await createTask(page, {
    goal: 'Write a one-paragraph markdown note titled "Hello". Keep it under 40 words.',
  });

  const first = await waitForTaskCompletion(page, 3 * 60_000);
  await screenshot(page, 'rerun-first-done');
  expect(first).toBe('completed');

  // Task is now in to_review with a deliverable. Click Re-run.
  // "Re-run" button lives in the task detail header for to_review tasks.
  const rerunBtn = page.locator('button').filter({ hasText: /^Re-run$/i });
  await expect(rerunBtn.first()).toBeVisible({ timeout: 5_000 });
  await rerunBtn.first().click();

  // Give the run a moment to register.
  await page.waitForTimeout(2000);

  // The status should now read Running (not Completed). If the bug is
  // present, the task would flash Running → Completed almost immediately
  // because the historical <deliverable> in the replayed TUI triggers
  // completion on the first text chunk.
  const detailHeader = page.locator('div.border-b:has(h2)');
  const statusSpan = detailHeader.locator('span:has(> span.rounded-full)');
  const statusAt2s = (await statusSpan.first().innerText()).trim();
  await screenshot(page, 'rerun-after-2s');

  // Must still be running at this point.
  expect(statusAt2s).toMatch(/Running|Planning|Clarifying/i);

  // Poll for 15s. The task must stay in Running state — if it flips to
  // Completed within 15s we've prematurely completed on echo.
  const start = Date.now();
  let flippedEarly = false;
  while (Date.now() - start < 15_000) {
    const s = (await statusSpan.first().innerText()).trim();
    if (/Completed/i.test(s)) {
      // Claude can genuinely finish a trivial task quickly, but NOT in under
      // 15s when resuming a workspace — the TUI render alone takes ~2s and a
      // real new turn needs model latency. If we see Completed this fast it's
      // almost certainly the echo bug.
      flippedEarly = true;
      break;
    }
    await page.waitForTimeout(1000);
  }

  await screenshot(page, 'rerun-15s-later');
  expect(flippedEarly).toBe(false);

  // Now wait for the real re-run to finish.
  const second = await waitForTaskCompletion(page, 3 * 60_000);
  await screenshot(page, 'rerun-done');
  expect(second).toBe('completed');
});
