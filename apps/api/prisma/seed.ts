import { PrismaClient, Role } from "@prisma/client";
import bcrypt from "bcrypt";

const prisma = new PrismaClient();

const hash = (value: string) => bcrypt.hash(value, 12);

async function main() {
  const ensureManager = async (username: string, displayName: string, initialPassword: string) => {
    const existing = await prisma.user.findUnique({ where: { username } });
    if (existing) return prisma.user.update({
      where: { id: existing.id },
      data: { displayName, role: Role.MANAGER, isActive: true }
    });
    return prisma.user.create({ data: {
      username, displayName, role: Role.MANAGER, isActive: true,
      passwordHash: await hash(initialPassword), mustChangePassword: false
    } });
  };

  const julia = await ensureManager("julia", "Julia", "Julia@123");
  const diego = await ensureManager("diego", "Diego", "Diego@123");

  console.log("✅ Seed concluído com sucesso!");
  console.log("\n📋 Usuários garantidos (senhas só são definidas na primeira criação):");
  console.log("Manager inicial: julia | Senha inicial: Julia@123");
  console.log("Manager inicial: diego | Senha inicial: Diego@123");
  console.log(`IDs: julia=${julia.id} diego=${diego.id}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
