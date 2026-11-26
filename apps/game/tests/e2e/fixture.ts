import type { Page } from '@playwright/test';

// A component test owns its canvas and worker for the duration of the page.
export async function openFixture(page: Page): Promise<void> {
  await page.route('**/isolated.html',route=>route.fulfill({contentType:'text/html',
    body:'<!doctype html><html><head><meta charset="utf-8"><style>html,body,#app{width:100%;height:100%;margin:0}</style></head><body><div id="app"></div></body></html>'}));
  await page.goto('./isolated.html');
}
