import { expect, test } from "@playwright/test";

const loginManager = async (page: import("@playwright/test").Page) => {
  await page.goto("/login");
  await page.getByLabel("Login").fill("julia");
  await page.getByLabel("Senha").fill("Julia@123");
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
};

test("login mantém a composição visual aprovada", async ({ page }) => {
  await page.goto("/login");
  await expect(page.getByRole("button", { name: "Entrar" })).toBeVisible();
  await expect(page).toHaveScreenshot("login.png", {
    animations: "disabled",
    caret: "hide",
    maxDiffPixelRatio: 0.01
  });
});

test("dashboard e equipe mantêm cards e distribuição aprovados", async ({ page }) => {
  await loginManager(page);
  await expect(page).toHaveScreenshot("manager-dashboard.png", {
    animations: "disabled",
    caret: "hide",
    mask: [page.locator(".kpi-grid"), page.locator(".chart-card")],
    maxDiffPixelRatio: 0.01
  });

  await page.goto("/chatters");
  await expect(page.getByRole("heading", { name: "Chatters", level: 1 })).toBeVisible();
  await page.addStyleTag({ content: ".chatter-table { height: 260px !important; overflow: hidden !important; }" });
  await expect(page).toHaveScreenshot("manager-chatters.png", {
    animations: "disabled",
    caret: "hide",
    mask: [page.locator(".chatter-table"), page.locator(".list-count")],
    maxDiffPixelRatio: 0.01
  });
});
