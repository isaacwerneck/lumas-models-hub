import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const apiBaseUrl = "http://127.0.0.1:3334/api/v1";

const login = async (page: Page, username = "julia", password = "Julia@123") => {
  await page.goto("/login");
  await page.getByLabel("Login").fill(username);
  await page.getByLabel("Senha").fill(password);
  await page.getByRole("button", { name: "Entrar" }).click();
  await expect(page).not.toHaveURL(/\/login$/);
};

const prepareChatter = async (request: APIRequestContext, projectName: string) => {
  const managerLogin = await request.post(`${apiBaseUrl}/auth/login`, {
    data: { username: "julia", password: "Julia@123" }
  });
  expect(managerLogin.ok()).toBe(true);
  const { accessToken } = await managerLogin.json() as { accessToken: string };
  const headers = { authorization: `Bearer ${accessToken}` };
  const username = `e2e.${projectName.replace(/[^a-z0-9]/gi, ".").toLowerCase()}`;
  const temporaryPassword = "E2eTemp@123";
  const finalPassword = "E2eFinal@123";
  const listResponse = await request.get(`${apiBaseUrl}/manager/chatters`, {
    headers,
    params: { page: "1", pageSize: "100", search: username }
  });
  expect(listResponse.ok()).toBe(true);
  const list = await listResponse.json() as { items: Array<{ id: string; username: string }> };
  const existing = list.items.find((item) => item.username === username);

  if (existing) {
    const reset = await request.post(`${apiBaseUrl}/manager/users/${existing.id}/reset-password`, {
      headers,
      data: { password: temporaryPassword }
    });
    expect(reset.ok()).toBe(true);
  } else {
    const created = await request.post(`${apiBaseUrl}/manager/users`, {
      headers,
      data: {
        username,
        displayName: `Chatter ${projectName}`,
        role: "CHATTER",
        password: temporaryPassword,
        isActive: true
      }
    });
    expect(created.ok()).toBe(true);
  }

  return { username, temporaryPassword, finalPassword };
};

const expectHealthyPage = async (page: Page) => {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  expect(overflow, "a página não deve extrapolar horizontalmente a viewport").toBe(false);
  const results = await new AxeBuilder({ page }).analyze();
  const blocking = results.violations.filter((violation) => violation.impact === "serious" || violation.impact === "critical");
  expect(blocking, blocking.map((violation) => `${violation.id}: ${violation.help}`).join("\n")).toEqual([]);
};

const expectKeyboardFocus = async (page: Page) => {
  await page.keyboard.press("Tab");
  const focusVisible = await page.evaluate(() => {
    const active = document.activeElement;
    if (!(active instanceof HTMLElement)) return false;
    const style = window.getComputedStyle(active);
    const rect = active.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden";
  });
  expect(focusVisible, "a página deve permitir navegação por teclado").toBe(true);
};

test("gerente percorre todas as rotas e encerra a sessão sem erros", async ({ page }) => {
  const errors: string[] = [];
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
  page.on("pageerror", (error) => errors.push(error.message));

  await login(page);
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
  // A restauração anônima inicial usa 401 como parte documentada do protocolo.
  errors.length = 0;
  const routes = [
    ["/home", "Dashboard"],
    ["/chatters", "Chatters"],
    ["/pagamentos", "Pagamentos"],
    ["/chat", "Central do modelo"],
    ["/funcionario-do-mes", "Funcionário do Mês"],
    ["/auditoria", "Auditoria"],
    ["/config", "Configurações"]
  ] as const;

  for (const [path, heading] of routes) {
    await page.goto(path);
    await expect(page.getByRole("heading", { name: heading, level: 1 })).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    expect(overflow, `${path} não deve extrapolar horizontalmente a viewport`).toBe(false);
  }

  await page.goto("/chatters?section=tags");
  await expect(page.getByRole("heading", { name: "Nova tag de modelo" })).toBeVisible();
  await expectHealthyPage(page);
  await expectKeyboardFocus(page);

  const moreButton = page.getByRole("button", { name: "Abrir mais opções" });
  if (await moreButton.isVisible()) {
    await moreButton.click();
    await page.getByRole("button", { name: "Sair da conta" }).click();
  } else {
    await page.getByRole("button", { name: "Sair", exact: true }).click();
  }
  await expect(page).toHaveURL(/\/login$/);
  expect(errors).toEqual([]);
});

test("chatter percorre todas as rotas operacionais e troca a senha temporária", async ({ page, request }, testInfo) => {
  const credentials = await prepareChatter(request, testInfo.project.name);
  await login(page, credentials.username, credentials.temporaryPassword);
  await expect(page).toHaveURL(/\/config$/);
  await page.getByLabel("Senha atual").fill(credentials.temporaryPassword);
  await page.getByLabel("Nova senha").fill(credentials.finalPassword);
  await page.getByRole("button", { name: "Alterar senha" }).click();
  await expect(page).toHaveURL(/\/login$/);
  await login(page, credentials.username, credentials.finalPassword);

  const routes = [
    ["/horarios", "Horários"],
    ["/pagamento", "Pagamento"],
    ["/chat", "Central do modelo"],
    ["/funcionario-do-mes", "Funcionário do Mês"],
    ["/config", "Configurações"]
  ] as const;

  for (const [path, heading] of routes) {
    await page.goto(path);
    await expect(page.getByRole("heading", { name: heading, level: 1 })).toBeVisible();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    expect(overflow, `${path} não deve extrapolar horizontalmente a viewport`).toBe(false);
  }

  await expectHealthyPage(page);
  await expectKeyboardFocus(page);
});
