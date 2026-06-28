import { getUserSettings, saveUserSettings } from "./api";

const SETTINGS_KEY = "educheck_user_settings";

export const defaultSettings = {
  theme: "system",
  accessibility: {
    enabled: false,
    fontSize: "xxlarge",
    colorScheme: "dark",
  },
  minimalUi: false,
  updatedAt: "",
};

const allowedThemes = new Set(["system", "light", "dark"]);
const allowedAccessibilityFontSizes = new Set(["large", "xlarge", "xxlarge"]);
const allowedAccessibilityColorSchemes = new Set(["light", "dark", "blue"]);

function normalizeAccessibility(settings = {}) {
  const accessibility = settings.accessibility || {};

  return {
    enabled: Boolean(accessibility.enabled),
    fontSize: allowedAccessibilityFontSizes.has(accessibility.fontSize)
      ? accessibility.fontSize
      : defaultSettings.accessibility.fontSize,
    colorScheme: allowedAccessibilityColorSchemes.has(accessibility.colorScheme)
      ? accessibility.colorScheme
      : defaultSettings.accessibility.colorScheme,
  };
}

export function normalizeSettings(settings = {}) {
  return {
    theme: allowedThemes.has(settings.theme) ? settings.theme : defaultSettings.theme,
    accessibility: normalizeAccessibility(settings),
    minimalUi: Boolean(settings.minimalUi),
    updatedAt: settings.updatedAt || "",
  };
}

export function readLocalSettings() {
  try {
    const rawSettings = localStorage.getItem(SETTINGS_KEY);
    return normalizeSettings(rawSettings ? JSON.parse(rawSettings) : defaultSettings);
  } catch {
    return defaultSettings;
  }
}

export function writeLocalSettings(settings) {
  const normalizedSettings = normalizeSettings({
    ...settings,
    updatedAt: settings.updatedAt || new Date().toISOString(),
  });
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(normalizedSettings));
  return normalizedSettings;
}

export async function loadUserSettings() {
  const localSettings = readLocalSettings();
  try {
    const remoteSettings = await getUserSettings();
    if (!remoteSettings) return { settings: localSettings, syncStatus: "local" };

    const normalizedRemoteSettings = normalizeSettings(remoteSettings);
    const localTime = Date.parse(localSettings.updatedAt || "") || 0;
    const remoteTime = Date.parse(normalizedRemoteSettings.updatedAt || "") || 0;
    const nextSettings = remoteTime > localTime ? normalizedRemoteSettings : localSettings;
    writeLocalSettings(nextSettings);
    return { settings: nextSettings, syncStatus: remoteTime > 0 ? "synced" : "local" };
  } catch {
    return { settings: localSettings, syncStatus: "pending" };
  }
}

export async function persistUserSettings(settings) {
  const localSettings = writeLocalSettings({
    ...settings,
    updatedAt: new Date().toISOString(),
  });

  try {
    await saveUserSettings(localSettings);
    return { settings: localSettings, syncStatus: "synced" };
  } catch {
    return { settings: localSettings, syncStatus: "pending" };
  }
}
