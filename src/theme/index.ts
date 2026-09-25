import { bindPresentedNames } from '../systems/names';
import { classicTheme } from './classic';
import { deepSeaTheme } from './deepSea';
import { bindTheme, isThemeId, requireTheme } from './registry';
import type { Theme, ThemeId } from './types';

export const THEME_KEY = 'pacman-101-theme';

export const THEMES: Record<ThemeId, Theme> = {
  classic: classicTheme,
  'deep-sea': deepSeaTheme,
};

function useTheme(theme: Theme): void {
  bindTheme(theme);
  bindPresentedNames(theme.cpuNames, theme.strings.defaultPlayerName);
}

useTheme(classicTheme);

export function activeTheme(): Theme {
  return requireTheme();
}

export function loadThemeId(store?: Pick<Storage, 'getItem'> | null): ThemeId {
  try {
    const saved = store?.getItem(THEME_KEY);
    if (saved && isThemeId(saved)) return saved;
  } catch {
    /* storage can be blocked */
  }
  return 'deep-sea';
}

export function applyThemeCss(theme: Theme): void {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  root.dataset.theme = theme.id;
  for (const [key, value] of Object.entries(theme.css)) root.style.setProperty(key, value);
}

/** Switch the client theme. Persists unless `persist` is false (tests). */
export function setActiveTheme(id: ThemeId, persist = true): Theme {
  const theme = THEMES[id];
  useTheme(theme);
  if (persist) {
    try {
      localStorage.setItem(THEME_KEY, id);
    } catch {
      /* private mode */
    }
  }
  applyThemeCss(theme);
  return theme;
}

/** Saved choice, or Deep Sea when this browser has not picked one. */
export function bootTheme(): Theme {
  let store: Pick<Storage, 'getItem'> | null = null;
  try {
    if (typeof localStorage !== 'undefined') store = localStorage;
  } catch {
    store = null;
  }
  return setActiveTheme(loadThemeId(store));
}

export type { Theme, ThemeId } from './types';
