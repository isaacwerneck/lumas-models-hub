export type Role = "CHATTER" | "MANAGER";

export type AuthUser = {
  id: string;
  username: string;
  displayName: string;
  role: Role;
  mustChangePassword?: boolean;
};

export type ChatRoom = {
  id: string;
  name: string;
  isActive: boolean;
};
