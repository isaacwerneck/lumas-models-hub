export type Role = "CHATTER" | "MANAGER";

export type AuthUser = {
  id: string;
  username: string;
  displayName: string;
  role: Role;
  mustChangePassword?: boolean;
  shiftReminderIntervalMinutes?: 15 | 30 | 45 | 60;
};

export type ChatRoom = {
  id: string;
  name: string;
  isActive: boolean;
};
