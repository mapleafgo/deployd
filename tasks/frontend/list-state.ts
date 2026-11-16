import { useNavigate, useSearch, useRouterState } from "@tanstack/react-router";
import { z } from "zod";
export const searchSchema = z.object({
  page: z.coerce.number().int().min(1).catch(1),
  size: z.coerce.number().int().min(1).max(100).catch(20),
  q: z.string().max(100).catch(""),
  name: z.string().optional().catch(undefined),
  run: z.string().optional().catch(undefined),
});
export function requestSearch(search: z.infer<typeof searchSchema>) {
  return {
    page: search.page,
    size: search.size,
    q: search.q,
    ...(search.name === undefined ? {} : { name: search.name }),
  };
}
export function useListState() {
  const search = searchSchema.parse(useSearch({ strict: false }));
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  return [
    search,
    (next: Partial<typeof search>, replace = false) => {
      void navigate({
        to: pathname === "/runs" ? "/runs" : "/",
        search: { ...search, ...next },
        replace,
      });
    },
  ] as const;
}
