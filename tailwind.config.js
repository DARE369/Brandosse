/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}", // 👈 This line ensures it scans your React files
  ],
  theme: {
    extend: {},
  },
  plugins: [],
}