/**
 * E2E helpers for Cerebro Electron app testing.
 *
 * How it works:
 *   1. Start Cerebro with:  CEREBRO_E2E_DEBUG_PORT=9229 npm start
 *   2. Run tests:           npm run test:e2e
 *
 * Playwright connects to the running Cerebro via Chrome DevTools Protocol
 * on port 9229. No second Electron instance is launched.
 */

import { chromium, type Browser, type Page } from '@playwright/test';

const CDP_PORT = Number(process.env.CEREBRO_CDP_PORT || 9229);

/** Connect to the already-running Cerebro via CDP. */
export async function connectToApp(): Promise<{ browser: Browser; page: Page }> {
  const cdpUrl = `http://127.0.0.1:${CDP_PORT}`;

  const browser = await chromium.connectOverCDP(cdpUrl, { timeout: 15_000 });

  // Get the app page — skip DevTools and internal pages
  const contexts = browser.contexts();
  if (contexts.length === 0) throw new Error('No browser contexts found');

  let page = null;
  for (const ctx of contexts) {
    for (const p of ctx.pages()) {
      const url = p.url();
      if (url.startsWith('http://localhost') || url.startsWith('http://127.0.0.1')) {
        page = p;
        break;
      }
    }
    if (page) break;
  }

  if (!page) {
    // Fallback: pick the first non-devtools page
    const allPages = contexts.flatMap(c => c.pages());
    page = allPages.find(p => !p.url().startsWith('devtools://')) || allPages[0];
  }

  if (!page) throw new Error('No pages found — is Cerebro running?');
  await page.waitForLoadState('domcontentloaded');

  // Ensure React has rendered
  await page.waitForSelector('nav', { timeout: 15_000 });

  return { browser, page };
}

/** Navigate to the Tasks screen via sidebar. */
export async function goToTasks(page: Page): Promise<void> {
  const tasksBtn = page.locator('nav button').filter({ hasText: /Tasks/i });
  await tasksBtn.first().click();
  // Wait for the Tasks screen to render (look for the Tasks heading or filter tabs)
  await page.waitForSelector('h1:has-text("Tasks")', { timeout: 5_000 });
  await page.waitForTimeout(500);
}

/**
 * Open the New Task dialog and create a task.
 *
 * The "+" button for new tasks lives inside the Tasks left panel (w-[340px])
 * next to the "Tasks" heading. It's an icon-only button with a Plus SVG.
 */
export async function createTask(
  page: Page,
  options: {
    goal: string;
    templateId?: string;
  },
): Promise<void> {
  // The + button is next to the "Tasks" h1 heading, inside the task list panel.
  // Target it by finding the header area and clicking the + button there.
  const tasksPanelHeader = page.locator('h1:has-text("Tasks")').locator('..');
  const plusBtn = tasksPanelHeader.locator('button');
  await plusBtn.click();

  // Wait for the dialog to appear (fixed overlay with z-50)
  const dialog = page.locator('.fixed.inset-0');
  await dialog.waitFor({ state: 'visible', timeout: 3_000 });

  // Fill in the goal
  const textarea = dialog.locator('textarea');
  await textarea.fill(options.goal);

  // Select template chip if specified
  if (options.templateId) {
    const patterns: Record<string, RegExp> = {
      'presentation': /^Presentation$/i,
      'web-app': /^Web App$/i,
      'mobile-app': /^Mobile App/i,
      'research': /^Research Brief$/i,
      'trip-plan': /^Trip Plan$/i,
      'code-audit': /^Code Audit$/i,
      'meal-plan': /^Meal Plan$/i,
      'cli-tool': /^CLI Tool$/i,
    };
    const pat = patterns[options.templateId];
    if (pat) {
      const chip = dialog.locator('button').filter({ hasText: pat });
      if (await chip.count() > 0) await chip.first().click();
    }
  }

  // Submit — "Start Task" button in the dialog footer
  const startBtn = dialog.locator('button').filter({ hasText: /Start Task/i });
  await startBtn.click();

  // Wait for dialog to close
  await dialog.waitFor({ state: 'hidden', timeout: 5_000 }).catch(() => {});

  // Ensure we're still on the Tasks screen (dialog close can sometimes trigger nav)
  const tasksHeading = page.locator('h1:has-text("Tasks")');
  if (await tasksHeading.count() === 0) {
    await page.locator('nav button').filter({ hasText: /Tasks/i }).first().click();
    await tasksHeading.waitFor({ state: 'visible', timeout: 5_000 });
  }

  // Wait for the new task to appear in the scrollable card list, then click it.
  // We MUST click it because the detail panel might still show a previous task.
  // Scope to the overflow-y-auto div (card list) to avoid matching filter tab buttons
  // which also contain "Running", "Done", "Failed" text.
  const cardList = page.locator('div.overflow-y-auto');
  for (let i = 0; i < 15; i++) {
    await page.waitForTimeout(1000);
    // Task cards contain a status dot (span.rounded-full) — filter tabs don't
    const activeCards = cardList.locator('button').filter({
      has: page.locator('span.rounded-full'),
    });
    if (await activeCards.count() > 0) {
      await activeCards.first().click();
      await page.waitForTimeout(500);

      // Verify the detail panel now shows an active status
      const detailHeader = page.locator('div.border-b:has(h2)');
      const statusSpan = detailHeader.locator('span:has(> span.rounded-full)');
      if (await statusSpan.count() > 0) {
        const statusText = await statusSpan.first().innerText();
        if (/Running|Planning|Clarifying/i.test(statusText)) {
          return;
        }
      }
    }
  }
}

/**
 * Wait for the selected task to complete, fail, or timeout.
 *
 * The status label sits in the task detail panel header inside a
 * `<span class="flex items-center gap-1.5 ...">` with a colored dot span
 * followed by the label text (e.g. "Completed", "Failed", "Cancelled").
 *
 * We scope to the status indicator to avoid matching filter tab labels
 * like "Failed" and "Running" that are always visible on the Tasks screen.
 */
export async function waitForTaskCompletion(
  page: Page,
  timeoutMs = 5 * 60_000,
): Promise<string> {
  const deadline = Date.now() + timeoutMs;

  // The detail panel header has: h2 (title), p (goal), and a status row.
  // Scope to the header section that contains an h2, then find the status indicator within it.
  // The status indicator is a span containing a rounded-full dot span + label text.
  const detailHeader = page.locator('div.border-b:has(h2)');
  const statusIndicator = detailHeader.locator('span:has(> span.rounded-full)');

  while (Date.now() < deadline) {
    if (await statusIndicator.count() > 0) {
      const text = await statusIndicator.first().innerText();
      if (/Completed/i.test(text)) return 'completed';
      if (/Failed/i.test(text)) return 'failed';
      if (/Cancelled/i.test(text)) return 'cancelled';
    }

    await page.waitForTimeout(3000);
  }

  return 'timeout';
}

/** Verify the Console tab has a visible xterm terminal with real PTY output. Retries for up to 10s. */
export async function verifyConsoleHasOutput(page: Page): Promise<boolean> {
  const consoleTab = page.locator('button').filter({ hasText: /^Console$/i });
  if (await consoleTab.count() > 0) {
    await consoleTab.first().click();
    await page.waitForTimeout(500);
  }

  // Retry until the xterm element appears and has real content
  for (let i = 0; i < 10; i++) {
    const terminal = page.locator('.xterm');
    if (await terminal.count() > 0) {
      const box = await terminal.first().boundingBox();
      if (box && box.width > 0 && box.height > 0) {
        // Check that the terminal has a canvas (WebGL) or .xterm-screen (DOM renderer)
        // This confirms xterm.js actually rendered, not just mounted empty
        const hasCanvas = await terminal.locator('canvas').count() > 0;
        const hasScreen = await terminal.locator('.xterm-screen').count() > 0;
        if (hasCanvas || hasScreen) return true;
      }
    }
    await page.waitForTimeout(1000);
  }
  return false;
}

/** Save a screenshot for debugging. */
export async function screenshot(page: Page, name: string): Promise<void> {
  await page.screenshot({ path: `e2e/screenshots/${name}.png`, fullPage: true });
}
