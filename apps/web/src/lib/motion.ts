export const motionTokens = {
  duration: {
    instant: 0.12,
    fast: 0.16,
    normal: 0.18,
    panel: 0.22
  },
  easing: {
    smooth: [0.22, 1, 0.36, 1]
  },
  distance: {
    page: 4,
    panel: 8,
    toast: 24
  },
  scale: {
    subtle: 0.98,
    press: 0.98
  }
} as const;

export const motionDurations = {
  instant: motionTokens.duration.instant,
  fast: motionTokens.duration.fast,
  base: motionTokens.duration.normal,
  slow: motionTokens.duration.panel
} as const;

export const motionSprings = {
  responsive: { type: "spring", stiffness: 420, damping: 34, mass: 0.8 },
  gentle: { type: "spring", stiffness: 240, damping: 28, mass: 0.9 }
} as const;

export const pageMotion = {
  initial: { opacity: 0, y: motionTokens.distance.page },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -motionTokens.distance.page }
} as const;
