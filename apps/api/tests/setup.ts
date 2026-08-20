import { execFileSync } from "node:child_process";
import path from "node:path";
import { createRequire } from "node:module";
import dotenv from "dotenv";
import { PrismaClient } from "@prisma/client";

dotenv.config({ path: path.resolve(__dirname, "../.env") });
const sourceUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
if (!sourceUrl) throw new Error("Defina TEST_DATABASE_URL ou DATABASE_URL para executar os testes.");
const testUrl = new URL(sourceUrl);
if (!process.env.TEST_DATABASE_URL) {
  const database = testUrl.pathname.replace(/^\//, "");
  const testDatabase = `${database}_test`;
  if (!/^[a-zA-Z0-9_]+$/.test(testDatabase)) throw new Error("Nome de banco de teste inválido.");
  const admin = new PrismaClient({ datasources: { db: { url: sourceUrl } } });
  const existing = await admin.$queryRawUnsafe<Array<{ datname: string }>>(
    "SELECT datname FROM pg_database WHERE datname = $1", testDatabase
  );
  if (!existing.length) await admin.$executeRawUnsafe(`CREATE DATABASE "${testDatabase}"`);
  await admin.$disconnect();
  testUrl.pathname = `/${testDatabase}`;
  testUrl.searchParams.set("schema", "public");
}
if (!testUrl.pathname.toLowerCase().includes("test")) {
  throw new Error("A suíte se recusa a usar um banco que não esteja identificado como teste.");
}
process.env.DATABASE_URL = testUrl.toString();
process.env.NODE_ENV = "test";
process.env.APP_ORIGIN ??= "http://localhost:5173";
process.env.JWT_ACCESS_SECRET ??= "test-access-secret-with-at-least-32-characters";
process.env.JWT_REFRESH_SECRET ??= "test-refresh-secret-with-at-least-32-characters";
process.env.COOKIE_SECURE = "false";

const resolveFromTest = createRequire(import.meta.url);
const prismaCli = resolveFromTest.resolve("prisma/build/index.js");
execFileSync(process.execPath, [prismaCli, "migrate", "deploy"], {
  cwd: path.resolve(__dirname, ".."), env: process.env, stdio: "inherit"
});
