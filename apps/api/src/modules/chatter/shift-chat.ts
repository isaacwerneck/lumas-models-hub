import type { Prisma } from "@prisma/client";
import { businessTimeLabel } from "../../utils/time";

export type ShiftChatEvent = "OPENED" | "CLOSED" | "CANCELLED";

export const createShiftChatEvent = async (
  tx: Prisma.TransactionClient,
  input: {
    chatterId: string;
    chatterDisplayName: string;
    modelTagId: string;
    shiftId: string;
    occurredAt: Date;
    event: ShiftChatEvent;
  }
) => {
  const action = input.event === "OPENED"
    ? "abriu o ponto"
    : input.event === "CLOSED"
      ? "bateu o ponto"
      : "cancelou o ponto";
  return tx.chatMessage.create({
    data: {
      modelTagId: input.modelTagId,
      senderId: input.chatterId,
      kind: "SHIFT_EVENT",
      shiftId: input.shiftId,
      eventType: input.event,
      occurredAt: input.occurredAt,
      content: `${input.chatterDisplayName} ${action} às ${businessTimeLabel(input.occurredAt)}h.`
    },
    include: {
      sender: {
        select: { id: true, username: true, displayName: true, role: true }
      }
    }
  });
};
