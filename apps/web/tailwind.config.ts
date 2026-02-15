import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: '#d7dbe2',
        panel: '#e6eaf0',
        border: '#aeb6c4',
        accent: '#1d4ed8',
        text: '#0b1220',
        muted: '#334155',
        danger: '#b91c1c',
        ok: '#047857'
      },
      boxShadow: {
        panel: '0 4px 14px rgba(15, 23, 42, 0.14), 0 1px 0 rgba(255, 255, 255, 0.35)',
        neon: '0 0 0 2px rgba(29, 78, 216, 0.2)'
      },
      backgroundImage: {
        'cyber-grid': 'linear-gradient(rgba(37,99,235,0.05) 1px, transparent 1px), linear-gradient(90deg, rgba(37,99,235,0.05) 1px, transparent 1px)'
      }
    }
  },
  plugins: []
};

export default config;
