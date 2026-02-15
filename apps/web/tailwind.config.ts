import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: '#f4f8ff',
        panel: '#ffffff',
        border: '#d4deef',
        accent: '#2563eb',
        text: '#0f172a',
        muted: '#475569',
        danger: '#dc2626',
        ok: '#059669'
      },
      boxShadow: {
        panel: '0 6px 16px rgba(15, 23, 42, 0.08), 0 1px 0 rgba(255, 255, 255, 0.8)',
        neon: '0 0 0 3px rgba(37, 99, 235, 0.16)'
      },
      backgroundImage: {
        'cyber-grid': 'linear-gradient(rgba(37,99,235,0.05) 1px, transparent 1px), linear-gradient(90deg, rgba(37,99,235,0.05) 1px, transparent 1px)'
      }
    }
  },
  plugins: []
};

export default config;
