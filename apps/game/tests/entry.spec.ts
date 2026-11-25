import { expect, test } from "@playwright/test"

test("桌面从子目录构建进入开始页", async ({ page }) => {
  const errors: string[] = []
  page.on("pageerror", error => errors.push(error.message))
  page.on("response", response => {
    if (response.status() >= 400) errors.push(response.url())
  })
  await page.goto("./")
  await expect(page.getByRole("heading", { name: "潮汐前哨" })).toBeVisible()
  await page.getByRole("button", { name: "开始", exact: true }).click()
  await expect(page.getByRole("heading", { name: "选择关卡" })).toBeVisible()
  expect(errors).toEqual([])
})

test.describe("手机横屏视口", () => {
  test.use({ viewport: { width: 844, height: 390 }, isMobile: true, hasTouch: true })

  test("实点开始与首关，战场留在可用区域内", async ({ page }) => {
    await page.goto("./")
    await page.getByRole("button", { name: "开始", exact: true }).tap()
    await page.getByRole("button", { name: /^灯塔湾/ }).tap()
    const canvas = page.locator("canvas")
    await expect(canvas).toBeVisible()
    await expect(canvas).toBeInViewport({ ratio: 0.98 })
  })
})
