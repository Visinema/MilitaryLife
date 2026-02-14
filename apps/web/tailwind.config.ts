import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: '#070b16',
        panel: '#0d1424',
        border: '#233154',
        accent: '#35f2ff',
        text: '#e6f3ff',
        muted: '#7f96bb',
        danger: '#ff6289',
        ok: '#49ffba'
      },
      boxShadow: {
        panel: '0 10px 30px rgba(0, 0, 0, 0.45), 0 0 0 1px rgba(53, 242, 255, 0.08), 0 0 18px rgba(53, 242, 255, 0.12)',
        neon: '0 0 16px rgba(53, 242, 255, 0.35)'
      },
      backgroundImage: {
        'cyber-grid': 'linear-gradient(rgba(53,242,255,0.08) 1px, transparent 1px), linear-gradient(90deg, rgba(53,242,255,0.08) 1px, transparent 1px)'
      }
    }
  },
  plugins: []
};

export default config;
