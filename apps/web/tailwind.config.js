/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        got_it: '#16a34a',
        neutral: '#2563eb',
        confused: '#ca8a04',
        lost: '#dc2626',
      },
    },
  },
  plugins: [],
};
