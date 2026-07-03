/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{js,jsx,ts,tsx}'],
  presets: [require('nativewind/preset')],
  theme: {
    extend: {
      colors: {
        background: '#0a0a0a',
        surface: '#18181b',
        'surface-high': '#27272a',
        accent: '#8b5cf6',
        muted: '#a1a1aa',
      },
    },
  },
  plugins: [],
};
