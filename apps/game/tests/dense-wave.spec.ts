import { expect, test } from "@playwright/test"

test.use({ viewport: { width: 667, height: 375 }, isMobile: true, hasTouch: true })

test("更窄横屏能完成外海两轮巡防", async ({ page }) => {
  test.setTimeout(65_000)
  await page.addInitScript(() => {
    for (const id of ["tide-bay", "tidal-reef"]) {
      localStorage.setItem("tide-outpost:clear:" + id, '{"version":1,"clear":true}')
    }
  })
  await page.goto("./")
  await page.getByRole("button", { name: "开始", exact: true }).tap()
  await page.getByRole("button", { name: /^外海巡防/ }).tap()
  await page.getByRole("button", { name: "倍速 1×" }).tap()
  for (let wave = 1; wave <= 3; wave++) {
    await expect(page.getByText(`第 ${wave} / 4 波`)).toBeVisible()
    await page.getByRole("button", { name: /^聚光镜/ }).tap()
    const confirm = page.getByRole("button", { name: "确认升级", exact: true })
    await expect(confirm).toBeInViewport({ ratio: 0.99 })
    await confirm.tap()
  }
  await expect(page.getByRole("heading", { name: "守住了外海巡防" })).toBeVisible()
  await page.getByRole("button", { name: "返回选关", exact: true }).tap()
  await expect(page.getByRole("button", { name: /^外海巡防.*已通关/ })).toBeVisible()
})
