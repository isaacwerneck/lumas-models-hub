import { useEffect } from "react";
import { io } from "socket.io-client";
import { getAccessToken } from "../lib/api";
import { playNotificationSound, showBrowserNotification } from "../lib/shiftNotifications";
import { useToast } from "./Toast";

type Reminder = { id: string; title: string; message: string; metadata?: { shiftId?: string } };

export const ShiftReminderListener = () => {
  const toast = useToast();
  useEffect(() => {
    const token = getAccessToken(); if (!token) return;
    const socket = io(import.meta.env.VITE_API_URL ?? "http://localhost:3333", { auth: { token }, reconnection: true });
    const onReminder = (reminder: Reminder) => {
      toast.info(`${reminder.title}: ${reminder.message}`);
      void playNotificationSound();
      showBrowserNotification({ id: reminder.id, title: reminder.title, message: reminder.message, critical: reminder.title.includes("faltam 1 minuto") });
    };
    socket.on("shift:reminder", onReminder);
    return () => { socket.off("shift:reminder", onReminder); socket.disconnect(); };
  }, [toast]);
  return null;
};
