import { createRoot } from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";
import * as ui from "@red-berry-kit/ui";
import { createWebRuntime } from "@red-berry-kit/web";
import { i18n } from "./i18n";
import { appName, preferenceScope, legacyPreferenceKeys } from "./application";
import { useBrand } from "./brand";
import { createModuleProviders, type ModuleRuntime } from "../.redberry/frontend/admin/providers";
import { createTransport } from "../.redberry/frontend/admin/http";
import { registerModuleTranslations } from "../.redberry/frontend/admin/resources";
import { router } from "./router";

const mount = document.getElementById("root");
if (!mount) throw new Error("缺少 root 挂载节点");
const environment = createWebRuntime({
  appName,
  i18n,
  origin: window.location.origin,
  registerTranslations: registerModuleTranslations,
  createTransport,
});
const runtime: ModuleRuntime = environment;
const ModuleProviders = createModuleProviders(runtime);
function Application() {
  const brand = useBrand();
  return (
    <ui.UIProvider
      i18n={i18n}
      scope={preferenceScope}
      brand={brand}
      legacyPreferenceKeys={legacyPreferenceKeys}
    >
      <title>{i18n.t("title")}</title>
      <QueryClientProvider client={runtime.queryClient}>
        <ModuleProviders>
          <RouterProvider router={router} />
        </ModuleProviders>
      </QueryClientProvider>
    </ui.UIProvider>
  );
}
createRoot(mount).render(<Application />);
