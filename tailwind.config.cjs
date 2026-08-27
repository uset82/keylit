/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        display: ["Tektur", "sans-serif"],
        mono: ["IBM Plex Mono", "monospace"],
      },
      colors: {
        ink: "#0a0b0c",
        steel: "#26292c",
        amber: "#e7c36a",
        acid: "#9dff6a",
        lcd: "#c3e02a",
        next: "#5ec8ff",
      },
    },
  },
  plugins: [],
};
