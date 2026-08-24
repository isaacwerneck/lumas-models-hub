import { PrismaClient, Role } from "@prisma/client";
import bcrypt from "bcrypt";
import dotenv from "dotenv";
import { z } from "zod";

dotenv.config();

const prisma = new PrismaClient();
const hash = (value: string) => bcrypt.hash(value, 12);

const bootstrapSchema = z.object({
  BOOTSTRAP_MANAGER_USERNAME: z.string().trim().min(3).max(64).transform((value) => value.toLowerCase()),
  BOOTSTRAP_MANAGER_DISPLAY_NAME: z.string().trim().min(2).max(120),
  BOOTSTRAP_MANAGER_PASSWORD: z.string().min(12).max(128)
});

type ManagerSeed = { username: string; displayName: string; password: string };

const managersForEnvironment = (): ManagerSeed[] => {
  if (process.env.NODE_ENV !== "production") {
    return [
      { username: "julia", displayName: "Julia", password: "Julia@123" },
      { username: "diego", displayName: "Diego", password: "Diego@123" }
    ];
  }

  const parsed = bootstrapSchema.safeParse(process.env);
  if (!parsed.success) {
    throw new Error(`Credenciais de bootstrap inválidas: ${parsed.error.message}`);
  }

  return [{
    username: parsed.data.BOOTSTRAP_MANAGER_USERNAME,
    displayName: parsed.data.BOOTSTRAP_MANAGER_DISPLAY_NAME,
    password: parsed.data.BOOTSTRAP_MANAGER_PASSWORD
  }];
};

async function main() {
  const ensureManager = async ({ username, displayName, password }: ManagerSeed) => {
    const existing = await prisma.user.findUnique({ where: { username } });
    if (existing) {
      console.log(`Manager existente preservado: ${username} (${existing.id})`);
      return existing;
    }

    const created = await prisma.user.create({
      data: {
        username,
        displayName,
        role: Role.MANAGER,
        isActive: true,
        passwordHash: await hash(password),
        mustChangePassword: true
      }
    });
    console.log(`Manager inicial criado: ${username} (${created.id}); troca de senha obrigatória.`);
    return created;
  };

  for (const manager of managersForEnvironment()) {
    await ensureManager(manager);
  }

  console.log("Seed concluído com sucesso.");
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
