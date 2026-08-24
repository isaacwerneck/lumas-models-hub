"use client";

import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import type { NotificationDto, NotificationListResponse } from "@lumas/contracts";
import { api } from "../lib/api";
import { formatDateTime } from "../lib/dateTime";
import { useToast } from "./Toast";
import { motionTokens } from "../lib/motion";

export const NotificationCenter = () => {
  const [open, setOpen] = useState(false);
  const seenIds = useRef(new Set<string>());
  const initialized = useRef(false);
  const centerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const { info, error } = useToast();
  const queryClient = useQueryClient();
  const reduceMotion = useReducedMotion();

  const notificationsQuery = useQuery({
    queryKey: ["notifications"],
    queryFn: async () => (await api.get<NotificationListResponse>("/notifications", { params: { page: 1, pageSize: 20 } })).data,
    refetchInterval: 60_000,
    refetchOnWindowFocus: true
  });
  const items = notificationsQuery.data?.items ?? [];
  const unreadCount = notificationsQuery.data?.unreadCount ?? 0;

  useEffect(() => {
    const onFocus = () => { void notificationsQuery.refetch(); };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [notificationsQuery.refetch]);

  useEffect(() => {
    if (!notificationsQuery.data) return;
    if (initialized.current) {
      for (const notification of notificationsQuery.data.items) {
        if (!notification.readAt && !seenIds.current.has(notification.id)) info(notification.title);
      }
    }
    notificationsQuery.data.items.forEach((notification) => seenIds.current.add(notification.id));
    initialized.current = true;
  }, [info, notificationsQuery.data]);

  useEffect(() => {
    if (!open) return;

    const closeFromOutside = (event: PointerEvent) => {
      if (!centerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeFromKeyboard = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      triggerRef.current?.focus();
    };

    document.addEventListener("pointerdown", closeFromOutside);
    document.addEventListener("keydown", closeFromKeyboard);
    return () => {
      document.removeEventListener("pointerdown", closeFromOutside);
      document.removeEventListener("keydown", closeFromKeyboard);
    };
  }, [open]);

  const updateCachedNotifications = (updater: (current: NotificationListResponse) => NotificationListResponse) => {
    queryClient.setQueryData<NotificationListResponse>(["notifications"], (current) => current ? updater(current) : current);
  };

  const markReadMutation = useMutation({
    mutationFn: async (notification: NotificationDto) => {
      if (!notification.readAt) await api.patch(`/notifications/${notification.id}/read`);
      return notification;
    },
    onSuccess: (notification) => updateCachedNotifications((current) => ({
      ...current,
      items: current.items.map((item) => item.id === notification.id ? { ...item, readAt: item.readAt ?? new Date().toISOString() } : item),
      unreadCount: Math.max(0, current.unreadCount - (notification.readAt ? 0 : 1))
    })),
    onError: () => error("Não foi possível marcar a notificação como lida.")
  });

  const markAllMutation = useMutation({
    mutationFn: async () => api.post("/notifications/read-all"),
    onSuccess: () => updateCachedNotifications((current) => ({
      ...current,
      items: current.items.map((item) => ({ ...item, readAt: item.readAt ?? new Date().toISOString() })),
      unreadCount: 0
    })),
    onError: () => error("Não foi possível atualizar as notificações.")
  });


  return (
    <div className="notification-center" ref={centerRef}>
      <button
        ref={triggerRef}
        className="notification-button"
        type="button"
        aria-label="Notificações"
        aria-expanded={open}
        aria-controls="notification-panel"
        onClick={() => setOpen((value) => !value)}
      >
        <img
          className="notification-icon"
          src="/assets/notification-bell.png"
          alt=""
          aria-hidden="true"
        />
        {unreadCount > 0 ? <span className="notification-count">{unreadCount > 99 ? "99+" : unreadCount}</span> : null}
      </button>
      <AnimatePresence initial={false}>
      {open ? (
        <motion.div
          id="notification-panel"
          key="notification-panel"
          className="notification-panel"
          initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: -motionTokens.distance.page, scale: motionTokens.scale.subtle }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: -motionTokens.distance.page, scale: motionTokens.scale.subtle }}
          transition={{ duration: reduceMotion ? motionTokens.duration.instant : motionTokens.duration.fast, ease: motionTokens.easing.smooth }}
        >
          <div className="notification-head">
            <strong>Notificações</strong>
            {unreadCount ? <button type="button" onClick={() => markAllMutation.mutate()}>Marcar todas como lidas</button> : null}
          </div>
          <div className="notification-list">
            {items.map((notification) => (
              <button
                type="button"
                key={notification.id}
                className={`notification-item ${notification.readAt ? "" : "unread"}`}
                onClick={() => markReadMutation.mutate(notification)}
              >
                <strong>{notification.title}</strong>
                <span>{notification.message}</span>
                <small>{formatDateTime(notification.createdAt)}</small>
              </button>
            ))}
            {items.length === 0 ? <p className="empty-hint">Nenhuma notificação por enquanto.</p> : null}
          </div>
        </motion.div>
      ) : null}
      </AnimatePresence>
    </div>
  );
};
