import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts", "src/**/*.test.ts"],
    testTimeout: 20_000, // 子プロセス起動を伴う統合テストがあるため長め
  },
});
