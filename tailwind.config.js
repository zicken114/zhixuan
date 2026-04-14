/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{vue,js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // Neural Interface Palette - Sophisticated dark theme
        'neural': {
          'bg-deep': '#07070d',
          'bg-surface': '#0d0d14',
          'bg-elevated': '#13131c',
          'bg-glass': 'rgba(13, 13, 20, 0.85)',
          'border': 'rgba(255, 255, 255, 0.06)',
          'border-bright': 'rgba(255, 255, 255, 0.12)',
        },
        'accent': {
          'cyan': '#00e5cc',
          'cyan-dim': 'rgba(0, 229, 204, 0.15)',
          'cyan-glow': 'rgba(0, 229, 204, 0.4)',
          'amber': '#f59e0b',
        },
        'text': {
          'primary': '#f0f0f5',
          'secondary': 'rgba(240, 240, 245, 0.6)',
          'muted': 'rgba(240, 240, 245, 0.4)',
        },
      },
      fontFamily: {
        'display': ['Syne', 'sans-serif'],
        'body': ['DM Sans', 'sans-serif'],
        'mono': ['JetBrains Mono', 'Fira Code', 'monospace'],
      },
      boxShadow: {
        'glow-cyan': '0 0 20px rgba(0, 229, 204, 0.3), 0 0 40px rgba(0, 229, 204, 0.1)',
        'glow-cyan-sm': '0 0 10px rgba(0, 229, 204, 0.2)',
        'neural': '0 8px 32px rgba(0, 0, 0, 0.5)',
      },
      animation: {
        'pulse-glow': 'pulse-glow 2s ease-in-out infinite',
        'float': 'float 3s ease-in-out infinite',
      },
      keyframes: {
        'pulse-glow': {
          '0%, 100%': { boxShadow: '0 0 20px rgba(0, 229, 204, 0.2), 0 0 40px rgba(0, 229, 204, 0.1)' },
          '50%': { boxShadow: '0 0 30px rgba(0, 229, 204, 0.4), 0 0 60px rgba(0, 229, 204, 0.2)' },
        },
        'float': {
          '0%, 100%': { transform: 'translateY(0)' },
          '50%': { transform: 'translateY(-4px)' },
        },
      },
    },
  },
  plugins: [],
}
