import { etzhayyimUIKit } from '@etzhayyim/design-system/plugin';

/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './index.html',
    './src/**/*.{html,js,svelte,ts}',
    '../../../../../../com-etzhayyim-svelte-design-system/dist/**/*.{svelte,js}',
    '../../../etzhayyim-project-calendar/appview/calendar-mcp-component/svelte/src/**/*.{svelte,ts}'
  ],
  darkMode: ['selector', '[data-theme="dark"]'],
  theme: {
    extend: {
      colors: {
        etzhayyim: {
          bg: 'var(--gv2-bg-primary)',
          sidebar: 'var(--gv2-bg-sidebar)',
          hover: 'var(--gv2-bg-hover)',
          input: 'var(--gv2-bg-input)',
          card: 'var(--gv2-bg-card)',
          text: 'var(--gv2-text-primary)',
          secondary: 'var(--gv2-text-secondary)',
          muted: 'var(--gv2-text-muted)',
          accent: 'var(--gv2-accent)',
          'accent-hover': 'var(--gv2-accent-hover)',
          border: 'var(--gv2-border)'
        }
      },
      fontFamily: {
        sans: [
          "'Noto Sans JP'",
          '-apple-system',
          'BlinkMacSystemFont',
          "'Segoe UI'",
          "'Hiragino Kaku Gothic ProN'",
          'sans-serif'
        ]
      }
    }
  },
  plugins: [etzhayyimUIKit]
};
