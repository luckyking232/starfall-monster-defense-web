import { defineConfig } from "vite"

export default defineConfig({
  base: "./",
  build: {
    target: ["chrome89", "safari15"],
    assetsInlineLimit: 0,
  },
})
