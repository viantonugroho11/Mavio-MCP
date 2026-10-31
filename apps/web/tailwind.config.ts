import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{ts,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        ground: "#FAFAF7",
        panel: "#F3F1EA",
        "panel-hover": "#ECEAE0",
        ink: "#0F1720",
        muted: "#5E6874",
        subtle: "#8892A0",
        rule: "#E3E1DA",
        accent: "#2E48D6",
        "accent-hover": "#2339B8",
        "accent-muted": "#EEF1FC",
        bronze: "#B8865C",
        "bronze-muted": "#F7EFE6",
        success: "#16A34A",
        "success-muted": "#DCFCE7",
        warning: "#D97706",
        "warning-muted": "#FEF3C7",
        danger: "#DC2626",
        "danger-muted": "#FEE2E2",
      },
      fontFamily: {
        display: ['"Iowan Old Style"', '"Palatino Linotype"', "Palatino", "ui-serif", "Georgia", "serif"],
        sans: ["Inter", "ui-sans-serif", "system-ui", "-apple-system", "sans-serif"],
        mono: ['"JetBrains Mono"', '"SF Mono"', "ui-monospace", "Menlo", "monospace"],
      },
      boxShadow: {
        card: "0 1px 3px 0 rgba(15,23,32,0.06), 0 1px 2px -1px rgba(15,23,32,0.04)",
        "card-hover": "0 4px 12px 0 rgba(15,23,32,0.10), 0 2px 4px -2px rgba(15,23,32,0.06)",
        focus: "0 0 0 3px rgba(46,72,214,0.20)",
      },
      borderRadius: {
        DEFAULT: "6px",
        lg: "10px",
        xl: "14px",
      },
    },
  },
  plugins: [],
};

export default config;
