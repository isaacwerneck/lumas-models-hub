export type BrowserNotificationPayload = {
  id?: string;
  title: string;
  message: string;
  critical?: boolean;
};

export const playNotificationSound = () => {
  const audio = new Audio("/assets/sound.mp3");
  audio.volume = 0.8;
  return audio.play().catch(() => undefined);
};

export const showBrowserNotification = (payload: BrowserNotificationPayload) => {
  if (!("Notification" in window) || Notification.permission !== "granted") return null;
  const notification = new Notification(payload.title, {
    body: payload.message,
    icon: "/assets/sidebar-logo.png",
    tag: payload.id ?? `lumas-${Date.now()}`,
    requireInteraction: payload.critical ?? false
  });
  notification.onclick = () => { window.focus(); notification.close(); };
  return notification;
};
