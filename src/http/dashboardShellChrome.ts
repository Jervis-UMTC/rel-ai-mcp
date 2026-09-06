function renderDashboardShellBootstrap(): string {
  return `try {
  const themePreference = localStorage.getItem('relai_ui_theme') || 'system';
  const resolvedTheme = themePreference === 'system' ? (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark') : themePreference;
  const launchParams = new URLSearchParams(location.search);
  const desktopSurface = launchParams.get('surface') === 'desktop';
  Object.assign(document.documentElement.dataset, {
    themePreference,
    theme: resolvedTheme,
    sidebar: localStorage.getItem('relai_sidebar_collapsed') === '1' ? 'collapsed' : 'expanded',
    surface: desktopSurface ? 'desktop' : 'browser',
    windowChrome: desktopSurface && launchParams.get('chrome') === 'custom' ? 'custom' : 'native',
    platform: launchParams.get('platform') || 'other'
  });
} catch {}`;
}

export { renderDashboardShellBootstrap };
