import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests", testMatch: "**/*.e2e.ts", timeout: 30_000, workers: 1,
  use: { baseURL: process.env.MIA_E2E_BASE_URL ?? "http://127.0.0.1:18081", channel: process.env.MIA_E2E_BROWSER_CHANNEL ?? "chrome", headless: true, screenshot: "only-on-failure", trace: "retain-on-failure" },
  webServer: process.env.MIA_E2E_BASE_URL ? undefined : [
    { command: "python -m uvicorn app.main:app --app-dir ../../services/demo-banking-api --host 127.0.0.1 --port 18081", url: "http://127.0.0.1:18081/health", reuseExistingServer: true, env: { ASSISTANT_URL: "http://127.0.0.1:18090/assistant/" } },
    { command: "python -m uvicorn app.main:app --app-dir ../../../MIAAssistant/services/agent-api --host 127.0.0.1 --port 18090", url: "http://127.0.0.1:18090/health", reuseExistingServer: true, env: { MIA_SCENARIO_CONFIG: "../../../DemoMSBWeb/config/mia-scenarios.yaml", ALLOWED_HOST_ORIGINS: "http://127.0.0.1:18081", MIA_DEMO_HOST_API_URL: "http://127.0.0.1:18081", MIA_MODEL_PROVIDER: "external-model", MIA_MODEL_BASE_URL: "", MIA_MODEL_API_KEY: "", MIA_MODEL_NAME: "" } },
  ],
});
