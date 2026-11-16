import { safeFailure, failureText, type SafeFailure, submitErrors } from "./errors";
import { useEffect, useRef, useState } from "react";
import { isTaskTimeout } from "./duration";
import { useForm, useStore } from "@tanstack/react-form";
import { z } from "zod";
import {
  Action,
  CheckField,
  Choice,
  FormActions,
  CodeField,
  FormDisclosure,
  ReadOnlyField,
  type CodeFieldHandle,
  Notice,
  RecordAction,
  Row,
  EditorRow,
  ScrollArea,
  TextField,
  Vertical,
} from "@red-berry-kit/ui";
import {
  commandsFor,
  scriptFor,
  variableRows,
  variablesSchema,
  variablesToObject,
} from "./editor-model";
import { type Task, type TaskInput, useTasksContext } from "./module";
import { Variables } from "./variables";
import { useTasksTranslation } from "./use-translation";
const stepSchema = z.object({
  key: z.string(),
  name: z.string().trim().min(1, "stepInvalid").max(100, "stepInvalid"),
  workdir: z.string().refine((value) => !value || value.startsWith("/"), "directoryInvalid"),
  env: variablesSchema,
  script: z.string().trim().min(1, "commandsInvalid"),
  originalScript: z.string(),
  originalCommands: z.array(z.string()),
});
const schema = z.object({
  name: z.string().regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/, "nameInvalid"),
  description: z.string().max(500, "descriptionInvalid"),
  workdir: z.string().startsWith("/", "directoryInvalid"),
  timeout: z.string().refine(isTaskTimeout, "timeoutInvalid"),
  queue: z.enum(["wait", "terminate"]),
  parallel: z.boolean(),
  env: variablesSchema,
  steps: z.array(stepSchema).min(1, "stepInvalid").max(100, "stepInvalid"),
});
function newStep(name = ""): z.infer<typeof stepSchema> {
  return {
    key: crypto.randomUUID(),
    name,
    workdir: "",
    env: variableRows({}),
    script: "",
    originalScript: "",
    originalCommands: [] as string[],
  };
}
export function TaskEditor({
  task,
  onSaved,
  onCancel,
  onBusy,
  onDirty,
  resumeFocus = 0,
}: {
  task: Task | null;
  onSaved: () => void;
  onCancel: () => void;
  onBusy: (value: boolean) => void;
  onDirty?: (value: boolean) => void;
  resumeFocus?: number;
}) {
  const { api } = useTasksContext();
  const { t } = useTasksTranslation();
  const element = useRef<HTMLFormElement>(null);
  const codeFields = useRef(new Map<string, CodeFieldHandle>());
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [focusTarget, setFocusTarget] = useState<{ path: string; attempt: number }>();
  const [attempted, setAttempted] = useState(false);
  const [serverErrors, setServerErrors] = useState<Record<string, string[] | undefined>>({});
  const [failure, setFailure] = useState<(SafeFailure & { reasons: string[] }) | null>(null);
  const [defaultValues] = useState(() => ({
    name: task?.name ?? "",
    description: task?.description ?? "",
    workdir: task?.workdir ?? "/tmp",
    timeout: task?.timeout ?? "30m",
    queue: task?.queue === "terminate" ? ("terminate" as const) : ("wait" as const),
    parallel: task?.parallel ?? false,
    env: variableRows(task?.env ?? {}),
    steps: task?.steps.map((step) => ({
      ...newStep(),
      name: step.name,
      workdir: step.workdir,
      env: variableRows(step.env ?? {}),
      script: scriptFor(step.commands),
      originalScript: scriptFor(step.commands),
      originalCommands: [...step.commands],
    })) ?? [newStep(t("defaultStepName"))],
  }));
  const form = useForm({
    defaultValues,
    validators: { onChange: schema, onSubmit: schema },
    onSubmit: async ({ value, formApi }) => {
      try {
        const input: TaskInput = {
          description: value.description,
          workdir: value.workdir,
          timeout: value.timeout,
          queue: value.queue,
          parallel: value.parallel,
          env: variablesToObject(value.env),
          steps: value.steps.map((step) => ({
            name: step.name,
            workdir: step.workdir,
            env: variablesToObject(step.env),
            commands: commandsFor(step.script, step.originalScript, step.originalCommands),
          })),
        };
        if (task) await api.updateTask(task.name, input);
        else await api.createTask({ name: value.name, ...input });
        setFailure(null);
        onSaved();
      } catch (error) {
        const failure = safeFailure(error);
        const errors = submitErrors(
          error,
          value.steps.map((step) => step.key),
          formApi.state.values.steps.map((step) => step.key),
        );
        setFailure({
          ...failure,
          reasons: errors.form.filter((reason) => reason !== failure.code),
        });
        setServerErrors(
          Object.fromEntries(
            Object.entries(errors.fields).map(([path, reasons]) => [errorIdentity(path), reasons]),
          ),
        );
        formApi.setErrorMap({ onSubmit: errors });
        // 保持 TanStack Form 失败语义；入口只消费已展示的异常。
        throw error;
      }
    },
  });
  const values = useStore(form.store, (state) => state.values);
  const isDefaultValue = useStore(form.store, (state) => state.isDefaultValue);
  useEffect(() => {
    onDirty?.(!isDefaultValue);
  }, [isDefaultValue, onDirty]);
  useEffect(() => () => onDirty?.(false), [onDirty]);
  const isSubmitting = useStore(form.store, (state) => state.isSubmitting);
  useEffect(() => {
    onBusy(isSubmitting);
  }, [isSubmitting, onBusy]);
  useEffect(() => () => onBusy(false), [onBusy]);
  const errors = (items: readonly unknown[]) =>
    items
      .flat(2)
      .map((item) =>
        t(
          typeof item === "string"
            ? item
            : typeof item === "object" && item !== null && "message" in item
              ? String(item.message)
              : "invalidInput",
        ),
      )
      .filter((message, index, messages) => messages.indexOf(message) === index)
      .join("; ") || undefined;
  function errorIdentity(path: string) {
    const match = /^steps\[(\d+)\](.*)$/.exec(path);
    if (!match) return path;
    const step = form.state.values.steps[Number(match[1])];
    return step ? `step:${step.key}${match[2]}` : path;
  }
  const clearServerError = (path: string) => {
    const identity = errorIdentity(path);
    setServerErrors((previous) => {
      if (!previous[identity]) return previous;
      const next = { ...previous };
      delete next[identity];
      return next;
    });
  };
  const fieldErrors = (path: string, items: readonly unknown[]) =>
    errors([...items, ...(serverErrors[errorIdentity(path)] ?? [])]);
  const revealErrors = () => {
    const current = form.state.values;
    const result = schema.safeParse(current);
    const paths = new Set<string>();
    if (!result.success) {
      for (const issue of result.error.issues) {
        let path = "";
        for (const part of issue.path)
          path += typeof part === "number" ? `[${part}]` : `${path ? "." : ""}${String(part)}`;
        paths.add(path);
      }
    }
    for (const [path, meta] of Object.entries(form.state.fieldMeta)) {
      if (meta?.errors.length) paths.add(path);
    }
    if (!paths.size) return;
    setExpanded((previous) => {
      const next = { ...previous };
      for (const path of paths) {
        if (path === "timeout" || path === "queue") next.execution = true;
        if (path === "description") next.description = true;
        if (path.startsWith("env")) next.env = true;
        const match = /^steps\[(\d+)\]/.exec(path);
        if (match) {
          const step = current.steps[Number(match[1])];
          if (step) {
            next[step.key] = true;
            if (path.includes(".env")) next[`${step.key}-env`] = true;
            if (path.endsWith(".name") || path.endsWith(".workdir"))
              next[`${step.key}-settings`] = true;
          }
        }
      }
      return next;
    });
    setFocusTarget((previous) => ({
      path: [...paths][0] ?? "name",
      attempt: (previous?.attempt ?? 0) + 1,
    }));
  };
  useEffect(() => {
    if (!focusTarget) return;
    const script = /^steps\[(\d+)\]\.script/.exec(focusTarget.path);
    if (script) {
      const step = form.state.values.steps[Number(script[1])];
      if (step) codeFields.current.get(step.key)?.focus();
      return;
    }
    const containers = element.current?.querySelectorAll<HTMLElement>("[data-field]");
    const container = Array.from(containers ?? []).find(
      (node) => node.dataset.field !== undefined && focusTarget.path.startsWith(node.dataset.field),
    );
    container?.querySelector<HTMLElement>("input, textarea, [role=textbox]")?.focus();
  }, [focusTarget, form]);
  useEffect(() => {
    if (resumeFocus > 0) {
      const first = form.state.values.steps[0];
      if (first) codeFields.current.get(first.key)?.focus();
    }
  }, [resumeFocus, form]);
  const open = (key: string, fallback = false) => expanded[key] ?? fallback;
  const changeOpen = (key: string) => (value: boolean) =>
    setExpanded((previous) => ({ ...previous, [key]: value }));
  const namedVariables = (stepEnv: typeof values.env) => {
    const names = new Map(
      values.env.filter((row) => row.key).map((row) => [row.key, t("taskVariables")]),
    );
    for (const row of stepEnv) if (row.key) names.set(row.key, t("stepVariables"));
    return Array.from(names, ([name, source]) => ({ name, source }));
  };
  return (
    <form
      ref={element}
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        setAttempted(true);
        void form
          .handleSubmit()
          .catch(() => undefined)
          .then(revealErrors);
      }}
    >
      <Vertical>
        {failure && <Notice>{failureText(failure, t)}</Notice>}
        {failure?.reasons.length ? <Notice>{errors(failure.reasons)}</Notice> : null}
        {attempted && !form.state.isValid && <Notice>{t("formErrors")}</Notice>}
        <ScrollArea label={t("taskForm")} h="min(62vh, 760px)" scrollbars="y">
          <Vertical>
            <Vertical>
              <EditorRow>
                {(["name", "workdir"] as const).map((name) => (
                  <form.Field name={name} key={name}>
                    {(field) => (
                      <div data-field={name}>
                        <TextField
                          label={t(name)}
                          value={field.state.value}
                          autoFocus={name === "name"}
                          withAsterisk
                          disabled={isSubmitting || (name === "name" && task !== null)}
                          onChange={(event) => {
                            clearServerError(field.name);
                            field.handleChange(event.currentTarget.value);
                          }}
                          onBlur={field.handleBlur}
                          error={fieldErrors(field.name, field.state.meta.errors)}
                        />
                      </div>
                    )}
                  </form.Field>
                ))}
              </EditorRow>
              <FormDisclosure
                title={t("description")}
                opened={open("description", !!values.description)}
                onChange={changeOpen("description")}
              >
                <form.Field name="description">
                  {(field) => (
                    <div data-field="description">
                      <TextField
                        label={t("description")}
                        value={field.state.value}
                        disabled={isSubmitting}
                        onChange={(event) => {
                          clearServerError(field.name);
                          field.handleChange(event.currentTarget.value);
                        }}
                        onBlur={field.handleBlur}
                        error={fieldErrors(field.name, field.state.meta.errors)}
                      />
                    </div>
                  )}
                </form.Field>
              </FormDisclosure>
            </Vertical>
            <FormDisclosure
              title={t("taskVariables")}
              summary={t("variableCount", { count: values.env.length })}
              opened={open("env", values.env.length > 0)}
              onChange={changeOpen("env")}
            >
              <Notice>{t("taskVariablesHint")}</Notice>
              <form.Field name="env" mode="array">
                {(field) => (
                  <div data-field="env">
                    <Variables
                      label={t("taskVariables")}
                      value={field.state.value}
                      error={fieldErrors(field.name, field.state.meta.errors)}
                      onChange={(value) => {
                        clearServerError(field.name);
                        field.handleChange(value);
                      }}
                      disabled={isSubmitting}
                    />
                  </div>
                )}
              </form.Field>
            </FormDisclosure>
            <Vertical>
              {values.steps.length > 1 && (
                <form.Field name="parallel">
                  {(field) => (
                    <CheckField
                      label={t("parallel")}
                      checked={field.state.value}
                      disabled={isSubmitting}
                      onChange={(event) => field.handleChange(event.currentTarget.checked)}
                      onBlur={field.handleBlur}
                    />
                  )}
                </form.Field>
              )}
              {values.steps.length > 1 && (
                <Notice>{t(values.parallel ? "parallelHint" : "serialHint")}</Notice>
              )}
              <form.Field name="steps" mode="array">
                {(steps) => (
                  <Vertical>
                    {steps.state.value.map((step, index) => (
                      <FormDisclosure
                        key={step.key}
                        title={t("stepTitle", { number: index + 1 })}
                        summary={step.name}
                        opened={steps.state.value.length === 1 || open(step.key, true)}
                        disabled={steps.state.value.length === 1}
                        onChange={changeOpen(step.key)}
                      >
                        <Vertical>
                          {step.originalCommands.length > 1 && (
                            <Notice>{t("independentCommandsHint")}</Notice>
                          )}
                          <form.Field name={`steps[${index}].script`}>
                            {(field) => (
                              <CodeField
                                label={t("script")}
                                value={field.state.value}
                                language="shell"
                                disabled={isSubmitting}
                                description={t("bashHint")}
                                variableNames={namedVariables(step.env)}
                                focusRef={(handle) => {
                                  if (handle) codeFields.current.set(step.key, handle);
                                  else codeFields.current.delete(step.key);
                                }}
                                onChange={(value) => {
                                  clearServerError(field.name);
                                  field.handleChange(value);
                                }}
                                onBlur={field.handleBlur}
                                error={fieldErrors(field.name, field.state.meta.errors)}
                              />
                            )}
                          </form.Field>
                          {steps.state.value.length > 1 && (
                            <Row>
                              <Action
                                icon="up"
                                intent="quiet"
                                disabled={isSubmitting || index === 0}
                                onClick={() => steps.swapValues(index, index - 1)}
                              >
                                {t("moveUp")}
                              </Action>
                              <Action
                                icon="down"
                                intent="quiet"
                                disabled={isSubmitting || index === steps.state.value.length - 1}
                                onClick={() => steps.swapValues(index, index + 1)}
                              >
                                {t("moveDown")}
                              </Action>
                              <RecordAction
                                icon="delete"
                                label={t("removeStep")}
                                disabled={isSubmitting || steps.state.value.length === 1}
                                onClick={() => steps.removeValue(index)}
                              />
                            </Row>
                          )}
                          <FormDisclosure
                            title={t("stepSettings")}
                            summary={step.workdir || t("inheritWorkdir", { path: values.workdir })}
                            opened={open(`${step.key}-settings`, !!step.workdir)}
                            onChange={changeOpen(`${step.key}-settings`)}
                          >
                            <EditorRow>
                              <form.Field name={`steps[${index}].name`}>
                                {(field) => (
                                  <div data-field={`steps[${index}].name`}>
                                    <TextField
                                      label={t("stepNameLabel")}
                                      value={field.state.value}
                                      disabled={isSubmitting}
                                      onChange={(event) => {
                                        clearServerError(field.name);
                                        field.handleChange(event.currentTarget.value);
                                      }}
                                      onBlur={field.handleBlur}
                                      error={fieldErrors(field.name, field.state.meta.errors)}
                                    />
                                  </div>
                                )}
                              </form.Field>
                              <form.Field name={`steps[${index}].workdir`}>
                                {(field) => (
                                  <div data-field={`steps[${index}].workdir`}>
                                    <TextField
                                      label={t("stepWorkdir")}
                                      value={field.state.value}
                                      disabled={isSubmitting}
                                      placeholder={t("inheritWorkdir", { path: values.workdir })}
                                      onChange={(event) => {
                                        clearServerError(field.name);
                                        field.handleChange(event.currentTarget.value);
                                      }}
                                      onBlur={field.handleBlur}
                                      error={fieldErrors(field.name, field.state.meta.errors)}
                                    />
                                  </div>
                                )}
                              </form.Field>
                            </EditorRow>
                          </FormDisclosure>
                          <ReadOnlyField
                            label={t("effectiveWorkdir")}
                            value={step.workdir || values.workdir}
                          />
                          <FormDisclosure
                            title={t("stepVariables")}
                            summary={t("stepVariablesSummary", {
                              inherited: values.env.length,
                              count: step.env.length,
                              overrides: step.env.filter((row) =>
                                values.env.some((item) => item.key === row.key),
                              ).length,
                            })}
                            opened={open(`${step.key}-env`, step.env.length > 0)}
                            onChange={changeOpen(`${step.key}-env`)}
                          >
                            <Notice>{t("stepVariablesHint")}</Notice>
                            {values.env.length > 0 && (
                              <ReadOnlyField
                                label={t("inheritedVariables")}
                                value={values.env
                                  .map((row) => row.key)
                                  .filter(Boolean)
                                  .join(", ")}
                              />
                            )}
                            <form.Field name={`steps[${index}].env`} mode="array">
                              {(field) => (
                                <div data-field={`steps[${index}].env`}>
                                  <Variables
                                    label={t("stepVariables")}
                                    value={field.state.value}
                                    inheritedNames={values.env.map((row) => row.key)}
                                    error={fieldErrors(field.name, field.state.meta.errors)}
                                    disabled={isSubmitting}
                                    onChange={(value) => {
                                      clearServerError(field.name);
                                      field.handleChange(value);
                                    }}
                                  />
                                </div>
                              )}
                            </form.Field>
                          </FormDisclosure>
                        </Vertical>
                      </FormDisclosure>
                    ))}
                    {errors(steps.state.meta.errors) && (
                      <Notice>{errors(steps.state.meta.errors)}</Notice>
                    )}
                    <Action
                      icon="add"
                      disabled={isSubmitting || steps.state.value.length >= 100}
                      onClick={() => {
                        const nextIndex = steps.state.value.length;
                        const step = newStep(t("defaultStepName"));
                        steps.pushValue(step);
                        setExpanded((previous) => ({ ...previous, [step.key]: true }));
                        setFocusTarget((previous) => ({
                          path: `steps[${nextIndex}].script`,
                          attempt: (previous?.attempt ?? 0) + 1,
                        }));
                      }}
                    >
                      {t("addStep")}
                    </Action>
                  </Vertical>
                )}
              </form.Field>
            </Vertical>
            <FormDisclosure
              title={t("executionSettings")}
              summary={t("executionSummary", { timeout: values.timeout, queue: t(values.queue) })}
              opened={open("execution")}
              onChange={changeOpen("execution")}
            >
              <form.Field name="timeout">
                {(field) => (
                  <div data-field="timeout">
                    <TextField
                      label={t("timeout")}
                      value={field.state.value}
                      disabled={isSubmitting}
                      onChange={(event) => {
                        clearServerError(field.name);
                        field.handleChange(event.currentTarget.value);
                      }}
                      onBlur={field.handleBlur}
                      error={fieldErrors(field.name, field.state.meta.errors)}
                    />
                  </div>
                )}
              </form.Field>
              <form.Field name="queue">
                {(field) => (
                  <Choice
                    label={t("queue")}
                    value={field.state.value}
                    disabled={isSubmitting}
                    data={[
                      { value: "wait", label: t("wait") },
                      { value: "terminate", label: t("terminate") },
                    ]}
                    onChange={(value) => {
                      field.handleChange(value === "terminate" ? "terminate" : "wait");
                      field.handleBlur();
                    }}
                  />
                )}
              </form.Field>
            </FormDisclosure>
          </Vertical>
        </ScrollArea>
        <FormActions>
          <Action icon="save" type="submit" loading={isSubmitting} disabled={isSubmitting}>
            {t(task ? "save" : "createTask")}
          </Action>
          <Action icon="close" intent="quiet" disabled={isSubmitting} onClick={onCancel}>
            {t("cancel")}
          </Action>
        </FormActions>
      </Vertical>
    </form>
  );
}
