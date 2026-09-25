import type { Theme, ThemeId } from './types';

/** Active theme. Classic until the client boots, so tests keep today's copy. */
let current: Theme | null = null;

export function peekTheme(): Theme | null {
  return current;
}

export function bindTheme(theme: Theme): void {
  current = theme;
}

export function requireTheme(): Theme {
  if (!current) throw new Error('theme is not ready');
  return current;
}

export function isThemeId(value: string): value is ThemeId {
  return value === 'classic' || value === 'deep-sea';
}
