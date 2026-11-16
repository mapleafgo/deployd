import { safeFailure, failureText, type SafeFailure } from "./errors";
import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useBlocker, useNavigate } from "@tanstack/react-router";
import {
  Action,
  CopyAction,
  EditorPanel,
  ListPage,
  Notice,
  RecordAction,
  RecordActions,
  Row,
  TextField,
  Vertical,
} from "@red-berry-kit/ui";
import { type Task, useTasksContext } from "./module";
import { TaskEditor } from "./task-editor";
import { webhookCommand, runDestination } from "./navigation";
import { useTasksTranslation } from "./use-translation";
import { requestSearch, useListState } from "./list-state";
import { useExitPresentation } from "./presentation";
import { useListFailure } from "./list-failure";
export function TasksPage() {
  const { api, queryClient, scope } = useTasksContext();
  const { t } = useTasksTranslation();
  const navigate = useNavigate();
  const [search, update] = useListState();
  const [draft, setDraft] = useState({ source: search.q, value: search.q });
  const q = draft.source === search.q ? draft.value : search.q;
  const setQ = (value: string) => setDraft({ source: search.q, value });
  const [editing, setEditing] = useState<Task | null | undefined>();
  const [deleting, setDeleting] = useState<Task>();
  const editor = useExitPresentation(editing);
  const deletion = useExitPresentation(deleting);
  const [editorDirty, setEditorDirty] = useState(false);
  const [discarding, setDiscarding] = useState(false);
  const [resumeFocus, setResumeFocus] = useState(0);
  const [editorBusy, setEditorBusy] = useState(false);
  const blocker = useBlocker({
    shouldBlockFn: () => editing !== undefined && (editorDirty || editorBusy),
    withResolver: true,
    enableBeforeUnload: editing !== undefined && (editorDirty || editorBusy),
  });
  function closeEditor() {
    if (editorBusy) return;
    if (editorDirty) setDiscarding(true);
    else setEditing(undefined);
  }
  function continueEditing() {
    setDiscarding(false);
    if (blocker.status === "blocked") blocker.reset();
  }
  const [triggerBusy, setTriggerBusy] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);
  const [triggerFailure, setTriggerFailure] = useState<SafeFailure | null>(null);
  const [deleteFailure, setDeleteFailure] = useState<SafeFailure | null>(null);
  const rowBusy = triggerBusy || deleteBusy;
  const interaction = useRef(0);
  useEffect(
    () => () => {
      interaction.current++;
    },
    [],
  );
  const [acceptedRun, setAcceptedRun] = useState<{ name: string; id: string }>();
  function openEditor(task: Task | null) {
    interaction.current++;
    setEditorDirty(false);
    setEditing(task);
  }
  const query = useQuery({
    queryKey: [scope, "tasks", search],
    queryFn: ({ signal }) => api.listTasks(requestSearch(search), { signal }),
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
  async function refresh() {
    await queryClient.invalidateQueries({ queryKey: [scope, "tasks"] });
  }
  async function trigger(task: Task) {
    const intent = ++interaction.current;
    setTriggerBusy(true);
    setTriggerFailure(null);
    setAcceptedRun(undefined);
    try {
      const run = await api.triggerTask(task.name, { env: {} });
      if (interaction.current === intent) void navigate(runDestination(task.name, run.id));
      else setAcceptedRun({ name: task.name, id: run.id });
    } catch (error) {
      setTriggerFailure(safeFailure(error));
    } finally {
      setTriggerBusy(false);
    }
  }
  return (
    <ListPage
      title={t("title")}
      listTitle={t("title")}
      rows={query.data?.items ?? []}
      rowKey={(row) => row.name}
      loading={query.isFetching}
      error={
        queryFailure
          ? failureText(safeFailure(queryFailure), t)
          : triggerFailure
            ? failureText(triggerFailure, t)
            : undefined
      }
      filtered={!!search.q}
      onRefresh={() => {
        void refresh();
      }}
      search={{
        fields: (
          <TextField
            label={t("keyword")}
            placeholder={t("taskSearchHint")}
            value={q}
            onChange={(event) => setQ(event.currentTarget.value)}
          />
        ),
        expanded: false,
        onExpandedChange: () => undefined,
        onSearch: () => update({ q, page: 1 }),
        onReset: () => {
          setQ("");
          update({ q: "", page: 1 });
        },
      }}
      toolbar={
        <>
          <Action icon="add" onClick={() => openEditor(null)}>
            {t("create")}
          </Action>
          {acceptedRun && (
            <Action
              icon="terminal"
              intent="quiet"
              onClick={() => {
                void navigate(runDestination(acceptedRun.name, acceptedRun.id));
              }}
            >
              {t("viewAcceptedRun", { name: acceptedRun.name })}
            </Action>
          )}
        </>
      }
      pagination={{
        page: query.data?.page ?? search.page,
        size: query.data?.size ?? search.size,
        total: query.data?.total ?? 0,
        onChange: (page, size) => update({ page, size }),
      }}
      columns={[
        { id: "name", label: t("name"), value: (row) => row.name },
        { id: "description", label: t("description"), value: (row) => row.description },
        {
          id: "actions",
          label: t("actions"),
          cell: (row) => (
            <RecordActions>
              <RecordAction
                icon="edit"
                label={t("edit")}
                disabled={rowBusy || query.isFetching}
                onClick={() => openEditor(row)}
              />
              <RecordAction
                icon="play"
                label={t("run")}
                disabled={rowBusy || query.isFetching}
                onClick={() => {
                  void trigger(row);
                }}
              />
              <RecordAction
                icon="history"
                label={t("history")}
                disabled={rowBusy || query.isFetching}
                onClick={() => {
                  void navigate({
                    to: "/runs",
                    search: { page: 1, size: 20, q: "", name: row.name },
                  });
                }}
              />
              <CopyAction
                variant="icon"
                value={webhookCommand(window.location.origin, row.name, row.token)}
                label={t("copyWebhook")}
                copiedLabel={t("copied")}
              />
              <RecordAction
                icon="delete"
                label={t("delete")}
                disabled={rowBusy || query.isFetching}
                onClick={() => {
                  interaction.current++;
                  setDeleteFailure(null);
                  setDeleting(row);
                }}
              />
            </RecordActions>
          ),
        },
      ]}
      overlay={
        <>
          <EditorPanel
            size="min(1200px, 95vw)"
            opened={editing !== undefined}
            title={t(editor.value ? "edit" : "createTitle")}
            busy={editorBusy}
            onClose={closeEditor}
            onClosed={editor.onClosed}
          >
            {editor.value !== undefined && (
              <TaskEditor
                key={editor.value?.name ?? "new"}
                task={editor.value}
                onBusy={setEditorBusy}
                onCancel={closeEditor}
                onDirty={setEditorDirty}
                resumeFocus={resumeFocus}
                onSaved={() => {
                  setDiscarding(false);
                  if (blocker.status === "blocked") blocker.reset();
                  setEditorDirty(false);
                  setEditing(undefined);
                  void refresh();
                }}
              />
            )}
          </EditorPanel>
          <EditorPanel
            opened={discarding || blocker.status === "blocked"}
            title={t("discardTitle")}
            busy={editorBusy}
            onClose={continueEditing}
            onClosed={() => {
              if (editing !== undefined) setResumeFocus((value) => value + 1);
            }}
          >
            <Vertical>
              <Notice>{t("discardHint")}</Notice>
              <Row>
                <Action icon="close" intent="quiet" onClick={continueEditing}>
                  {t("continueEditing")}
                </Action>
                <Action
                  icon="delete"
                  intent="danger"
                  disabled={editorBusy}
                  onClick={() => {
                    setDiscarding(false);
                    setEditorDirty(false);
                    setEditing(undefined);
                    if (blocker.status === "blocked") blocker.proceed();
                  }}
                >
                  {t("discardChanges")}
                </Action>
              </Row>
            </Vertical>
          </EditorPanel>
          <EditorPanel
            opened={!!deleting}
            title={t("delete")}
            busy={deleteBusy}
            onClose={() => setDeleting(undefined)}
            onClosed={deletion.onClosed}
          >
            <Vertical>
              <Notice>{t("confirmDelete", { name: deletion.value?.name })}</Notice>
              {deleteFailure && <Notice>{failureText(deleteFailure, t)}</Notice>}
              <Action
                icon="delete"
                intent="danger"
                disabled={deleteBusy || !deleting}
                loading={deleteBusy}
                onClick={() => {
                  if (!deleting) return;
                  setDeleteBusy(true);
                  setDeleteFailure(null);
                  void api
                    .deleteTask(deleting.name)
                    .then(() => {
                      setDeleteFailure(null);
                      setDeleting(undefined);
                      // 刷新失败属于列表查询，不把已成功的删除误报为失败。
                      void refresh();
                    })
                    .catch((error) => setDeleteFailure(safeFailure(error)))
                    .finally(() => setDeleteBusy(false));
                }}
              >
                {t("delete")}
              </Action>
            </Vertical>
          </EditorPanel>
        </>
      }
    />
  );
}

/** 兼容旧公开入口；新调用方使用表达领域职责的 TasksPage。 */
export { TasksPage as ModulePage };
