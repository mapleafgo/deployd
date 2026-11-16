import { safeFailure, failureText } from "./errors";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { EditorPanel, ListPage, RecordAction, TextField, formatTime } from "@red-berry-kit/ui";
import { useTasksContext } from "./module";
import { requestSearch, useListState } from "./list-state";
import { useTasksTranslation } from "./use-translation";
import { RunLog } from "./run-log";
import { useExitPresentation } from "./presentation";
import { useListFailure } from "./list-failure";
export function RunsPage() {
  const { api, scope } = useTasksContext();
  const { t, i18n } = useTasksTranslation();
  const [search, update] = useListState();
  const [draft, setDraft] = useState({ source: search.q, value: search.q });
  const q = draft.source === search.q ? draft.value : search.q;
  const setQ = (value: string) => setDraft({ source: search.q, value });
  const selected = search.run;
  const log = useExitPresentation(selected);
  const setSelected = (run: string | undefined) => update({ run });
  const query = useQuery({
    queryKey: [scope, "runs", search],
    queryFn: ({ signal }) => api.listRuns(requestSearch(search), { signal }),
    refetchInterval: 2000,
  });
  const queryFailure = useListFailure(
    query.error,
    query.isFetching,
    JSON.stringify([scope, search]),
  );
  useEffect(() => {
    if (query.data && !query.isPlaceholderData && query.data.page !== search.page)
      update({ page: query.data.page }, true);
  }, [query.data, query.isPlaceholderData, search.page, update]);
  const date = (value: string) => formatTime(value, i18n.resolvedLanguage);
  return (
    <ListPage
      title={t("history")}
      listTitle={search.name ? t("taskHistory", { name: search.name }) : t("history")}
      rows={query.data?.items ?? []}
      rowKey={(row) => row.id}
      loading={query.isFetching}
      error={queryFailure ? failureText(safeFailure(queryFailure), t) : undefined}
      filtered={!!search.q || !!search.name}
      onRefresh={() => {
        void query.refetch();
      }}
      search={{
        fields: (
          <TextField
            label={t("taskName")}
            placeholder={t("runSearchHint")}
            value={q}
            onChange={(event) => setQ(event.currentTarget.value)}
          />
        ),
        expanded: false,
        onExpandedChange: () => undefined,
        onSearch: () => update({ q, page: 1 }),
        onReset: () => {
          setQ("");
          update({ q: "", name: undefined, page: 1 });
        },
      }}
      pagination={{
        page: query.data?.page ?? search.page,
        size: query.data?.size ?? search.size,
        total: query.data?.total ?? 0,
        onChange: (page, size) => update({ page, size }),
      }}
      columns={[
        { id: "name", label: t("name"), value: (row) => row.name },
        { id: "status", label: t("runStatus"), value: (row) => t(`status.${row.status}`) },
        { id: "created", label: t("createdAt"), value: (row) => date(row.created_at) },
        {
          id: "actions",
          label: t("actions"),
          cell: (row) => (
            <RecordAction
              icon="terminal"
              label={t("viewLog")}
              disabled={query.isFetching}
              onClick={() => setSelected(row.id)}
            />
          ),
        },
      ]}
      overlay={
        <EditorPanel
          opened={!!selected}
          title={t("viewLog")}
          onClose={() => setSelected(undefined)}
          onClosed={log.onClosed}
        >
          {log.value && (
            <RunLog
              key={log.value}
              id={log.value}
              enabled={!!selected}
              onCompleted={() => {
                void query.refetch();
              }}
              onCancelAccepted={() => {
                void query.refetch();
              }}
            />
          )}
        </EditorPanel>
      }
    />
  );
}
