/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: "#0b0d10",
        panel: "#13161b",
        panel2: "#181c22",
        line: "#242a33",
        ink: "#e8eaed",
        sub: "#9aa3ad",
        brand: "#5b8cff",
        good: "#37d399",
        warn: "#f4b740",
        bad: "#f06363",
      },
      fontFamily: {
        sans: ["Inter", "ui-sans-serif", "system-ui", "Segoe UI", "sans-serif"],
        mono: ["ui-monospace", "SFMono-Regular", "Menlo", "monospace"],
      },
    },
  },
  plugins: [],
};
