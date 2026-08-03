import { PrismaClient, Role } from "@prisma/client";
import bcrypt from "bcrypt";

const prisma = new PrismaClient();

const hash = (value: string) => bcrypt.hash(value, 12);

async function main() {
  const managerPassword = await hash("Manager@123");
  const chatterPassword = await hash("Chatter@123");

  const manager = await prisma.user.upsert({
    where: { username: "gerente.julia" },
    update: {
      displayName: "Julia Tesouraria",
      role: Role.MANAGER,
      isActive: true,
      passwordHash: managerPassword
    },
    create: {
      username: "gerente.julia",
      displayName: "Julia Tesouraria",
      role: Role.MANAGER,
      isActive: true,
      passwordHash: managerPassword
    }
  });

  const chatterUsers = await Promise.all([
    prisma.user.upsert({
      where: { username: "chatter.ana" },
      update: {
        displayName: "Ana Santos",
        role: Role.CHATTER,
        isActive: true,
        passwordHash: chatterPassword
      },
      create: {
        username: "chatter.ana",
        displayName: "Ana Santos",
        role: Role.CHATTER,
        isActive: true,
        passwordHash: chatterPassword
      }
    }),
    prisma.user.upsert({
      where: { username: "chatter.bruno" },
      update: {
        displayName: "Bruno Lima",
        role: Role.CHATTER,
        isActive: true,
        passwordHash: chatterPassword
      },
      create: {
        username: "chatter.bruno",
        displayName: "Bruno Lima",
        role: Role.CHATTER,
        isActive: true,
        passwordHash: chatterPassword
      }
    }),
    prisma.user.upsert({
      where: { username: "chatter.clara" },
      update: {
        displayName: "Clara Rocha",
        role: Role.CHATTER,
        isActive: true,
        passwordHash: chatterPassword
      },
      create: {
        username: "chatter.clara",
        displayName: "Clara Rocha",
        role: Role.CHATTER,
        isActive: true,
        passwordHash: chatterPassword
      }
    })
  ]);

  const modelTags = await Promise.all([
    prisma.modelTag.upsert({
      where: { name: "Modelo A" },
      update: { isActive: true },
      create: { name: "Modelo A", isActive: true }
    }),
    prisma.modelTag.upsert({
      where: { name: "Modelo B" },
      update: { isActive: true },
      create: { name: "Modelo B", isActive: true }
    })
  ]);

  await prisma.chatterModelTag.deleteMany({
    where: {
      chatterId: { in: chatterUsers.map((user) => user.id) }
    }
  });

  await prisma.chatterModelTag.createMany({
    data: [
      {
        chatterId: chatterUsers[0].id,
        modelTagId: modelTags[0].id
      },
      {
        chatterId: chatterUsers[1].id,
        modelTagId: modelTags[0].id
      },
      {
        chatterId: chatterUsers[1].id,
        modelTagId: modelTags[1].id
      },
      {
        chatterId: chatterUsers[2].id,
        modelTagId: modelTags[1].id
      }
    ]
  });

  console.log("Seed concluído com sucesso.");
  console.log("Manager:", manager.username, "senha: Manager@123");
  console.log("Chatters: chatter.ana | chatter.bruno | chatter.clara, senha: Chatter@123");
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
