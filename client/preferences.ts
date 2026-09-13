export type Theme = 'system' | 'dark' | 'light';
export const THEME_KEY = 'hermes-ng-theme';
export function themeValue(value: unknown): Theme { return value === 'dark' || value === 'light' ? value : 'system'; }
export function readTheme(): Theme { try { return themeValue(localStorage.getItem(THEME_KEY)); } catch { return 'system'; } }
export function applyTheme(theme: Theme, save = false): void {
  document.documentElement.dataset.theme = theme === 'system' ? (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light') : theme;
  if (save) { try { localStorage.setItem(THEME_KEY, theme); } catch { /* Private mode: appearance still works for this tab. */ } }
}
export function dateGroup(timestamp: number, now = Date.now()): string {
  if (!timestamp) return 'Conversations';
  const date = new Date(timestamp * 1000), today = new Date(now); today.setHours(0, 0, 0, 0);
  const age = today.getTime() - date.getTime();
  return age <= 0 ? 'Today' : age <= 86400000 ? 'Yesterday' : age <= 6 * 86400000 ? 'Previous 7 days' : 'Earlier';
}
