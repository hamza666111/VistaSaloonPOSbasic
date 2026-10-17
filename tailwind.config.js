/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        teal: Object.fromEntries([50,100,200,300,400,500,600,700,800,900,950].map(level => [level, `rgb(var(--accent-${level}) / <alpha-value>)`])),
      },
    },
  },
  plugins: [],
}