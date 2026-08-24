import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import dotenv from "dotenv";
import { PrismaClient } from "@prisma/client";

const apiRoot = path.resolve(__dirname, "..");
dotenv.config({ path: path.join(apiRoot, ".env") });

const main = async () => {
  const sourceUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!sourceUrl) throw new Error("Defina TEST_DATABASE_URL ou DATABASE_URL para executar o E2E.");
  process.env.DIRECT_URL ??= sourceUrl;

  const e2eUrl = new URL(sourceUrl);
  const sourceDatabase = e2eUrl.pathname.replace(/^\//, "");
  const e2eDatabase = `${sourceDatabase.replace(/_test$/i, "")}_e2e_test`;
  if (!/^[a-zA-Z0-9_]+$/.test(e2eDatabase)) throw new Error("Nome de banco E2E inválido.");

  const admin = new PrismaClient({ datasources: { db: { url: sourceUrl } } });
  const existing = await admin.$queryRawUnsafe<Array<{ datname: string }>>(
    "SELECT datname FROM pg_database WHERE datname = $1",
    e2eDatabase
  );
  if (!existing.length) await admin.$executeRawUnsafe(`CREATE DATABASE "${e2eDatabase}"`);
  await admin.$disconnect();

  e2eUrl.pathname = `/${e2eDatabase}`;
  e2eUrl.searchParams.set("schema", "public");
  process.env.DATABASE_URL = e2eUrl.toString();
  process.env.DIRECT_URL = e2eUrl.toString();
  process.env.NODE_ENV = "test";
  process.env.COOKIE_SECURE = "false";
  process.env.STORAGE_DRIVER = "local";
  process.env.LOCAL_STORAGE_PATH = ".data/e2e-evidence";

  const resolveFromScript = createRequire(path.join(apiRoot, "package.json"));
  const prismaCli = resolveFromScript.resolve("prisma/build/index.js");

  execFileSync(process.execPath, [prismaCli, "migrate", "reset", "--force", "--skip-seed"], {
    cwd: apiRoot,
    env: process.env,
    stdio: "inherit"
  });
  execFileSync(process.execPath, ["--import", "tsx", "prisma/seed.ts"], {
    cwd: apiRoot,
    env: process.env,
    stdio: "inherit"
  });

  await import("../src/server");
};

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});
