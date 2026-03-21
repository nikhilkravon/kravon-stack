export function applyTheme(theme, title) {
  const root = document.documentElement;
  if (!theme || typeof theme !== 'object') {
    return;
  }

  const vars = {
    '--color-primary': theme.primary_color || '#c0392b',
    '--color-secondary': theme.secondary_color || '#f5f0e8',
    '--color-accent': theme.accent_color || '#e67e22',
    '--font-heading': theme.font_heading || 'Georgia, serif',
    '--font-body': theme.font_body || 'Inter, sans-serif',
    '--color-text': theme.color_text || '#1a1a1a',
    '--color-muted': theme.color_muted || '#6b7280',
  };

  Object.entries(vars).forEach(([key, value]) => {
    root.style.setProperty(key, value);
  });

  if (title && typeof title === 'string') {
    document.title = title;
  }
}
