/**
 * Copyright (c) 2026 Ngo Quoc Huy
 * SPDX-License-Identifier: AGPL-3.0-only
 * See the LICENSE file for details.
 */

import { appendFileSync } from "node:fs";
import { performance } from "node:perf_hooks";

import { expect, test, type Page } from "@playwright/test";

const webUrl = process.env.PLANE_REFERENCE_WEB_URL ?? "http://localhost:3001";
const projectUrl = process.env.PLANE_REFERENCE_PROJECT_URL;
const email = process.env.PLANE_REFERENCE_EMAIL;
const password = process.env.PLANE_REFERENCE_PASSWORD;
const auditLog = process.env.PLANE_REFERENCE_AUDIT_LOG;
const correlationId = process.env.PLANE_REFERENCE_CORRELATION_ID ?? "create-work-items-local";

test.use({ viewport: { width: 1440, height: 1000 } });
test.setTimeout(120_000);

function audit(
  action: string,
  outcome: "started" | "success" | "failure",
  target: string,
  startedAt?: number,
  error?: unknown
) {
  if (!auditLog) return;
  const rawReason = error instanceof Error ? error.message : error ? String(error) : undefined;
  const reason = rawReason
    ?.replaceAll(email ?? "", "[REDACTED]")
    .replaceAll(password ?? "", "[REDACTED]")
    .slice(0, 500);
  appendFileSync(
    auditLog,
    `${JSON.stringify({
      timestamp: new Date().toISOString(),
      correlation_id: correlationId,
      actor: { type: "user", id: "reference-browser" },
      action,
      target: { type: "reference-scenario", id: target },
      outcome,
      ...(startedAt === undefined ? {} : { duration_ms: Math.round(performance.now() - startedAt) }),
      ...(reason ? { reason } : {}),
    })}\n`
  );
}

async function audited<T>(action: string, target: string, run: () => Promise<T>): Promise<T> {
  return test.step(action, async () => {
    const startedAt = performance.now();
    audit(action, "started", target);
    try {
      const result = await run();
      audit(action, "success", target, startedAt);
      return result;
    } catch (error) {
      audit(action, "failure", target, startedAt, error);
      throw error;
    }
  });
}

function issueForm(page: Page) {
  return page.locator("form").filter({ has: page.getByPlaceholder("Title") });
}

async function openCreateModal(page: Page, title: string) {
  await audited("work-item.form-open", title, async () => {
    await page.getByRole("button", { name: "Add work item", exact: true }).click();
    await page.getByPlaceholder("Title").fill(title);
  });
}

async function saveWorkItem(page: Page, title: string) {
  await audited("work-item.save", title, async () => {
    const responsePromise = page.waitForResponse(
      (response) => response.request().method() === "POST" && new URL(response.url()).pathname.endsWith("/issues/")
    );
    await issueForm(page).getByRole("button", { name: "Save", exact: true }).click();
    expect((await responsePromise).status()).toBe(201);
    await expect(page.getByPlaceholder("Title")).toBeHidden();
    await expect(page.getByText(title, { exact: true }).first()).toBeVisible();
  });
}

async function selectSearchOption(page: Page, buttonName: string, optionName: string) {
  await audited("work-item.property-menu-open", optionName, async () => {
    await issueForm(page).getByRole("button", { name: buttonName, exact: true }).first().click();
  });
  await audited("work-item.property-search", optionName, async () => {
    const search = page.getByPlaceholder("Search").last();
    await search.fill(optionName);
  });
  await audited("work-item.property-option-click", optionName, async () => {
    const option = page.locator('[role="option"]').filter({ hasText: optionName });
    await option.click();
  });
}

async function selectTodayAsStartDate(page: Page) {
  await audited("work-item.start-date-select", "today", async () => {
    const trigger = issueForm(page).getByRole("button", { name: "Start date", exact: true }).first();
    const triggerBox = await trigger.boundingBox();
    await trigger.click();

    const calendar = page.locator(".rdp-root");
    await expect(calendar).toBeVisible();
    const calendarBox = await calendar.boundingBox();
    expect(triggerBox, "date trigger must be rendered").toBeTruthy();
    expect(calendarBox, "calendar must be rendered").toBeTruthy();
    expect(Math.abs(calendarBox!.x - triggerBox!.x)).toBeLessThanOrEqual(2);
    expect(calendarBox!.y).toBeGreaterThanOrEqual(triggerBox!.y + triggerBox!.height);

    await calendar.locator(".rdp-today button").click();
    await expect(trigger).toHaveCount(0);
  });
}

async function openProject(page: Page, url: string) {
  try {
    await page.goto(url);
  } catch (error) {
    if (!(error instanceof Error) || !error.message.includes("net::ERR_ABORTED")) throw error;
    await page.goto(url);
  }
}

test("creates representative work items through the real interface", async ({ page }) => {
  page.setDefaultTimeout(10_000);
  page.setDefaultNavigationTimeout(15_000);
  expect(projectUrl, "PLANE_REFERENCE_PROJECT_URL is required").toBeTruthy();
  expect(email, "PLANE_REFERENCE_EMAIL is required").toBeTruthy();
  expect(password, "PLANE_REFERENCE_PASSWORD is required").toBeTruthy();

  await audited("session.sign-in-open", "reference-user", async () => {
    await page.goto(`${webUrl}/sign-in`);
  });
  await audited("session.email-submit", "reference-user", async () => {
    await page.getByRole("textbox", { name: "Email" }).fill(email!);
    await page.getByRole("button", { name: "Continue", exact: true }).click();
  });
  await audited("session.password-submit", "reference-user", async () => {
    await page.getByRole("textbox", { name: "Password" }).fill(password!);
    const signInResponse = page.waitForResponse(
      (response) => response.request().method() === "POST" && new URL(response.url()).pathname === "/auth/sign-in/"
    );
    await page.getByRole("button", { name: "Go to workspace", exact: true }).click();
    expect((await signInResponse).status()).toBe(302);
    await expect(page.getByRole("button", { name: "Open workspace switcher" })).toBeVisible();
  });

  await audited("project.open", "high-cardinality-options", async () => {
    await openProject(page, projectUrl!);
    await expect(page.getByRole("button", { name: "Add work item", exact: true })).toBeVisible();
  });

  await openCreateModal(page, "Reference minimal work item");
  await saveWorkItem(page, "Reference minimal work item");

  await openCreateModal(page, "Reference high-cardinality work item");
  await selectTodayAsStartDate(page);
  await selectSearchOption(page, "Reference State 000", "Reference State 049");
  await selectSearchOption(page, "Labels", "Reference Label 0999");
  await selectSearchOption(page, "Cycle", "Reference Cycle 0249");
  await selectSearchOption(page, "Modules", "Reference Module 0499");
  await selectSearchOption(page, "Assignees", "Picker Member 0498");

  await audited("work-item.property-select", "Reference Estimate 49", async () => {
    await issueForm(page).getByRole("button", { name: "Estimate", exact: true }).first().click();
    await page.getByPlaceholder("Type to search").fill("49");
    await page.getByPlaceholder("Type to search").press("ArrowDown");
    await page.getByPlaceholder("Type to search").press("Enter");
  });
  await saveWorkItem(page, "Reference high-cardinality work item");

  await openCreateModal(page, "Reference child work item");
  await audited("work-item.parent-select-by-identifier", "Reference minimal work item", async () => {
    await issueForm(page).getByRole("button", { name: "Add parent", exact: true }).click();
    await page.getByPlaceholder("Type to search").fill("Reference minimal work item");
    const parentOption = page.locator('[role="option"]').filter({ hasText: "Reference minimal work item" });
    await expect(parentOption).toBeVisible();

    const identifier = parentOption.locator("button:disabled");
    const identifierBox = await identifier.boundingBox();
    expect(identifierBox, "parent identifier must be rendered").toBeTruthy();
    await page.mouse.click(identifierBox!.x + identifierBox!.width / 2, identifierBox!.y + identifierBox!.height / 2);

    await expect(parentOption).toBeHidden();
    await expect(issueForm(page).getByRole("button", { name: "REF-1", exact: true }).first()).toBeVisible();
  });
  await saveWorkItem(page, "Reference child work item");
});
