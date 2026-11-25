import { expect, test } from "@playwright/test"
import type { Page } from "@playwright/test"

async function openLevel(page: Page, level = "灯塔湾") {
  await page.goto("./")
  await page.getByRole("button", { name: "开始", exact: true }).click()
  await page.getByRole("button", { name: new RegExp("^" + level) }).click()
  await page.getByRole("button", { name: "倍速 1×" }).click()
}

async function upgrade(page: Page, name = "聚光镜") {
  await page.getByRole("button", { name: new RegExp(name) }).click()
  await page.getByRole("button", { name: "确认升级", exact: true }).click()
}

test.describe("手机横屏完整首局", () => {
  test.use({ viewport: { width: 844, height: 390 }, isMobile: true, hasTouch: true })

  test("触控升级、胜利后解锁并在重开时读取", async ({ page, context }, info) => {
    test.setTimeout(65_000)
    const errors: string[] = []
    page.on("pageerror", error => errors.push(error.message))
    page.on("response", response => {
      if (response.status() >= 400) errors.push(response.url())
    })
    await page.goto("./")
    await page.screenshot({ path: info.outputPath("start-small-landscape.png") })
    await page.getByRole("button", { name: "开始", exact: true }).tap()
    await expect(page.getByRole("button", { name: /^断潮礁/ })).toBeDisabled()
    await page.getByRole("button", { name: /^灯塔湾/ }).tap()
    await page.getByRole("button", { name: "倍速 1×" }).tap()
    const choice = page.getByRole("button", { name: /聚光镜/ })
    const confirm = page.getByRole("button", { name: "确认升级", exact: true })
    await expect(choice).toBeInViewport({ ratio: 0.99 })
    await expect(confirm).toBeDisabled()
    await choice.tap()
    await expect(confirm).toBeInViewport({ ratio: 0.99 })
    await page.screenshot({ path: info.outputPath("upgrade-small-landscape.png") })
    await confirm.tap()
    await expect(page.getByText("脉冲伤害 3")).toBeVisible()
    await upgrade(page)
    await expect(page.getByRole("heading", { name: "守住了灯塔湾" })).toBeVisible()
    await page.getByRole("button", { name: "返回选关", exact: true }).tap()
    await expect(page.getByRole("button", { name: /^灯塔湾.*已通关/ })).toBeVisible()
    await expect(page.getByRole("button", { name: /^断潮礁/ })).toBeEnabled()
    expect(errors).toEqual([])

    await page.close()
    const reopened = await context.newPage()
    await reopened.goto("./index.html")
    await expect(reopened.getByRole("button", { name: "开始", exact: true })).toBeVisible()
    await reopened.getByRole("button", { name: "开始", exact: true }).tap()
    await expect(reopened.getByRole("button", { name: /^断潮礁/ })).toBeEnabled()
  })
})

test("后台中断升级，退出取消和确认分别回到正确位置", async ({ page }) => {
  test.setTimeout(50_000)
  await openLevel(page)
  await expect(page.getByRole("heading", { name: "选择升级" })).toBeVisible()
  const unconfirmed = page.getByRole("button", { name: /^储能线圈/ })
  await unconfirmed.click()
  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", { value: true, configurable: true })
    document.dispatchEvent(new Event("visibilitychange"))
  })
  await expect(page.getByRole("heading", { name: "已暂停" })).toBeVisible()
  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", { value: false, configurable: true })
    document.dispatchEvent(new Event("visibilitychange"))
  })
  await page.getByRole("button", { name: "继续", exact: true }).click()
  await expect(page.getByRole("heading", { name: "选择升级" })).toBeVisible()
  await expect(unconfirmed).toHaveAttribute("aria-pressed", "true")
  await page.getByRole("button", { name: "暂停", exact: true }).click()
  await page.getByRole("button", { name: "退出本局", exact: true }).click()
  await page.getByRole("button", { name: "取消", exact: true }).click()
  await expect(page.getByRole("heading", { name: "已暂停" })).toBeVisible()
  await page.getByRole("button", { name: "退出本局", exact: true }).click()
  await page.getByRole("button", { name: "确认退出", exact: true }).click()
  await expect(page.getByRole("heading", { name: "选择关卡" })).toBeVisible()
  await expect(page.getByRole("button", { name: /^断潮礁/ })).toBeDisabled()
  await page.getByRole("button", { name: /^灯塔湾/ }).click()
  await expect(page.locator("canvas")).toBeVisible()
  await page.reload()
  await expect(page.getByRole("button", { name: "开始", exact: true })).toBeVisible()
})

test("故意选低输出可走失败结算，失败不再解锁", async ({ page }) => {
  test.setTimeout(65_000)
  await page.addInitScript(() => localStorage.setItem("tide-outpost:clear:tide-bay", '{"version":1,"clear":true}'))
  await openLevel(page, "断潮礁")
  await upgrade(page, "抢修舱")
  await expect(page.getByRole("heading", { name: "前哨失守" })).toBeVisible()
  await page.getByRole("button", { name: "返回选关", exact: true }).click()
  await expect(page.getByRole("button", { name: /^外海巡防/ })).toBeDisabled()
})

test("胜利写入拒绝后可退出结算并保留本次通关", async ({ page }) => {
  test.setTimeout(65_000)
  await page.addInitScript(() => {
    const set = Storage.prototype.setItem
    Storage.prototype.setItem = function (key, value) {
      if (key.startsWith("tide-outpost:clear:")) throw new Error("Storage disabled")
      set.call(this, key, value)
    }
  })
  await openLevel(page)
  await upgrade(page)
  await upgrade(page)
  await expect(page.getByRole("heading", { name: "守住了灯塔湾" })).toBeVisible()
  await page.getByRole("button", { name: "返回选关", exact: true }).click()
  await expect(page.getByRole("alert")).toContainText("无法写入本地进度")
  await page.getByRole("button", { name: "仅本次保留", exact: true }).click()
  await expect(page.getByRole("button", { name: /^断潮礁/ })).toBeEnabled()
  await page.reload()
  await page.getByRole("button", { name: "开始", exact: true }).click()
  await expect(page.getByRole("button", { name: /^断潮礁/ })).toBeDisabled()
})
