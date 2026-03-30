import { defineConfig } from "vite";

export default defineConfig({
  server: {
    port: 8080
  },
  build: {
    rollupOptions: {
      onwarn(warning, warn) {
        if (
          warning.code === "MODULE_LEVEL_DIRECTIVE" &&
          typeof warning.id === "string" &&
          warning.id.includes("react-router/dist/development")
        ) {
          return;
        }
        warn(warning);
      }
    }
  }
});
