/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        got_it: '#16a34a',
        neutral: '#2563eb',
        confused: '#ca8a04',
        lost: '#dc2626',
        brand: {
          50: '#eef4ff',
          100: '#dae6ff',
          200: '#bdd4ff',
          300: '#90b8ff',
          400: '#5c91ff',
          500: '#3668fc',
          600: '#2046f1',
          700: '#1833de',
          800: '#1a2bb4',
          900: '#1b2a8d',
          950: '#151b56',
        },
      },
    },
  },
  plugins: [],
};
