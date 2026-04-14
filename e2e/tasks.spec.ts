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
