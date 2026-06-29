const LAYOUT_PREFERENCES_KEY = "educheck_layout_preferences";

export const layoutLimits = {
  main: {
    min: 240,
    collapseBelow: 240,
    defaultWidth: 280,
  },
  settings: {
    min: 180,
    collapseBelow: 160,
    defaultWidth: 220,
  },
};

export const defaultLayoutPreferences = {
  mainSidebarWidth: layoutLimits.main.defaultWidth,
  isMainSidebarCollapsed: false,
  settingsSidebarWidth: layoutLimits.settings.defaultWidth,
  isSettingsSidebarCollapsed: false,
};

function clampWidth(value, limits) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) return limits.defaultWidth;
  return Math.min(getSidebarMaxWidth(limits), Math.max(limits.min, numericValue));
}

export function getSidebarMaxWidth(limits) {
  const viewportWidth = typeof window === "undefined" ? 0 : window.innerWidth;
  const thirdOfViewport = Math.floor(viewportWidth / 3);
  return Math.max(limits.min, thirdOfViewport || limits.defaultWidth);
}

export function normalizeLayoutPreferences(preferences = {}) {
  return {
    mainSidebarWidth: clampWidth(preferences.mainSidebarWidth, layoutLimits.main),
    isMainSidebarCollapsed: Boolean(preferences.isMainSidebarCollapsed),
    settingsSidebarWidth: clampWidth(preferences.settingsSidebarWidth, layoutLimits.settings),
    isSettingsSidebarCollapsed: Boolean(preferences.isSettingsSidebarCollapsed),
  };
}

export function readLayoutPreferences() {
  try {
    const rawPreferences = localStorage.getItem(LAYOUT_PREFERENCES_KEY);
    return normalizeLayoutPreferences(rawPreferences ? JSON.parse(rawPreferences) : defaultLayoutPreferences);
  } catch {
    return defaultLayoutPreferences;
  }
}

export function writeLayoutPreferences(preferences) {
  const normalizedPreferences = normalizeLayoutPreferences(preferences);
  localStorage.setItem(LAYOUT_PREFERENCES_KEY, JSON.stringify(normalizedPreferences));
  return normalizedPreferences;
}
