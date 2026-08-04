export type Role = "CHATTER" | "MANAGER";

export type AuthUser = {
  id: string;
  username: string;
  displayName: string;
  role: Role;
};

export type ApiError = {
  message?: string;
};

export type ChatRoom = {
  id: string;
  name: string;
  isActive: boolean;
};
