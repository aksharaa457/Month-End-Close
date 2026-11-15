import type { Config } from "tailwindcss";
import animate from "tailwindcss-animate";

const c = (name: string) => `hsl(var(--${name}) / <alpha-value>)`;

export default {
  darkMode: ["class"],
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ["Inter", "system-ui", "sans-serif"],
        display: ["'Plus Jakarta Sans'", "Inter", "sans-serif"],
      },
      colors: {
        border: c("border"),
        input: c("input"),
        ring: c("ring"),
        background: c("background"),
        foreground: c("foreground"),
        canvas: c("canvas"),
        primary: { DEFAULT: c("primary"), foreground: c("primary-foreground") },
        secondary: { DEFAULT: c("secondary"), foreground: c("secondary-foreground") },
        muted: { DEFAULT: c("muted"), foreground: c("muted-foreground") },
        accent: { DEFAULT: c("accent"), foreground: c("accent-foreground") },
        destructive: { DEFAULT: c("destructive"), foreground: c("destructive-foreground") },
        success: { DEFAULT: c("success"), foreground: c("success-foreground") },
        warning: { DEFAULT: c("warning"), foreground: c("warning-foreground") },
        ai: { DEFAULT: c("ai"), foreground: c("ai-foreground"), soft: c("ai-soft") },
        card: { DEFAULT: c("card"), foreground: c("card-foreground") },
        popover: { DEFAULT: c("popover"), foreground: c("popover-foreground") },
        sidebar: { DEFAULT: c("sidebar"), foreground: c("sidebar-foreground"), muted: c("sidebar-muted") },
      },
      borderRadius: { lg: "0.625rem", md: "0.5rem", sm: "0.375rem" },
    },
  },
  plugins: [animate],
} satisfies Config;
