import type { Prisma } from "@prisma/client";
import { businessTimeLabel } from "../../utils/time";

type ShiftChatEvent = "OPENED" | "CLOSED";

export const createShiftChatEvent = async (
  tx: Prisma.TransactionClient,
  input: {
    chatterId: string;
    chatterDisplayName: string;
    modelTagId: string;
    occurredAt: Date;
    event: ShiftChatEvent;
  }
) => {
  const action = input.event === "OPENED" ? "abriu o ponto" : "bateu o ponto";
  return tx.chatMessage.create({
    data: {
      modelTagId: input.modelTagId,
      senderId: input.chatterId,
      kind: "SHIFT_EVENT",
      content: `${input.chatterDisplayName} ${action} às ${businessTimeLabel(input.occurredAt)}h.`
    },
    include: {
      sender: {
        select: { id: true, username: true, displayName: true, role: true }
      }
    }
  });
};
