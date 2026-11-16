import { mergeConfig } from "vitest/config";
import { playwright } from "@vitest/browser-playwright";
import config from "../../vitest.config.ts";
// 独立组件复验复用根配置，使用独立端口，不占根统一 runner。
export default mergeConfig(
  { ...config, test: { ...config.test, projects: [] } },
  {
    test: {
      projects: [
        {
          test: {
            name: "browser",
            api: { host: "127.0.0.1", port: 6368, strictPort: true },
            include: ["tasks/tests/*.test.tsx", "tasks/frontend/*.test.tsx"],
            browser: {
              enabled: true,
              headless: true,
              connectTimeout: 10000,
              provider: playwright({
                contextOptions: {
                  reducedMotion:
                    process.env.DEPLOYD_REDUCED_MOTION === "reduce" ? "reduce" : "no-preference",
                },
              }),
              instances: [{ browser: "chromium" }],
            },
          },
        },
      ],
    },
  },
);
