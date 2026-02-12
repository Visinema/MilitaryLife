import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: '#161c1a',
        panel: '#202926',
        border: '#313d38',
        accent: '#8a9a5b',
        text: '#e8ece8',
        muted: '#a3ada6',
        danger: '#c05656',
        ok: '#71a36b'
      },
      boxShadow: {
        panel: '0 4px 14px rgba(0, 0, 0, 0.28)'
      }
    }
  },
  plugins: []
};

export default config;
