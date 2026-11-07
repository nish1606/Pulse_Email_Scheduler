/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ["Inter", "system-ui", "sans-serif"],
      },
      colors: {
        ong: {
          primary: "#16A34A",
          primaryDark: "#00A63E",
          tint: "#E8F5EE",
          text: "#111111",
          muted: "#9CA3AF",
          input: "#F4F6F5",
          border: "#E5E7EB",
        },
      },
    },
  },
  plugins: [],
};
