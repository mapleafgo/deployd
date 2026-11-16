import { createRootRoute, createRouter } from "@tanstack/react-router";
import { ApplicationRoot, MissingPage } from "@red-berry-kit/web";
import { createRoutes as moduleRoutes } from "../.redberry/frontend/admin/routes";
import { ModuleRouteBoundary } from "../.redberry/frontend/admin/providers";
import { shellContributions } from "../.redberry/frontend/admin/shell";
import { createRoutes } from "./index";
import { useBrand } from "./brand";

function Root() {
  const brand = useBrand();
  return (
    <ModuleRouteBoundary>
      <ApplicationRoot brand={brand} contributions={shellContributions} />
    </ModuleRouteBoundary>
  );
}
const root = createRootRoute({ notFoundComponent: MissingPage, component: Root });
export const router = createRouter({
  basepath: import.meta.env.BASE_URL,
  routeTree: root.addChildren([...createRoutes(root), ...moduleRoutes(root)]),
});
declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
