import type { UIBrand } from "@red-berry-kit/ui";
import { useAppTranslation } from "./i18n";

export function useBrand(): UIBrand {
  const { t } = useAppTranslation();
  return { name: t("brand"), homeHref: import.meta.env.BASE_URL };
}
