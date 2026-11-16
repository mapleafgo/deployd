import { safeFailure, failureText, type SafeFailure, submitErrors } from "./errors";
import { useEffect, useState } from "react";
import { isTaskTimeout } from "./duration";
import { useForm, useStore } from "@tanstack/react-form";
import { z } from "zod";
import {
  Action,
  CheckField,
  Choice,
  FormActions,
  FormSection,
  NoteField,
  Notice,
  RecordAction,
  Row,
  SectionGrid,
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
function newStep(): z.infer<typeof stepSchema> {
  return {
    key: crypto.randomUUID(),
    name: "",
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
}: {
  task: Task | null;
  onSaved: () => void;
  onCancel: () => void;
  onBusy: (value: boolean) => void;
}) {
  const { api } = useTasksContext();
  const { t } = useTasksTranslation();
  const [failure, setFailure] = useState<(SafeFailure & { reasons: string[] }) | null>(null);
  const form = useForm({
    defaultValues: {
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
      })) ?? [newStep()],
    },
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
        formApi.setErrorMap({ onSubmit: errors });
        // 保持 TanStack Form 失败语义；入口只消费已展示的异常。
        throw error;
      }
    },
  });
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
      .join("; ") || undefined;
  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void form.handleSubmit().catch(() => undefined);
      }}
    >
      <form.Subscribe selector={(state) => state.isSubmitting}>
        {(busy) => (
          <Vertical>
            {failure && <Notice>{failureText(failure, t)}</Notice>}
            {failure?.reasons.length ? <Notice>{errors(failure.reasons)}</Notice> : null}
            <SectionGrid>
              <ScrollArea
                label={t("settings")}
                h={{ base: "auto", lg: "min(65vh, 720px)" }}
                scrollbars="y"
              >
                <FormSection title={t("settings")}>
                  <Vertical>
                    {(["name", "description", "workdir", "timeout"] as const).map((name) => (
                      <form.Field name={name} key={name}>
                        {(field) => (
                          <TextField
                            label={t(name)}
                            value={field.state.value}
                            disabled={busy || (name === "name" && task !== null)}
                            onChange={(event) => field.handleChange(event.currentTarget.value)}
                            onBlur={field.handleBlur}
                            error={errors(field.state.meta.errors)}
                          />
                        )}
                      </form.Field>
                    ))}
                    <form.Field name="queue">
                      {(field) => (
                        <Choice
                          label={t("queue")}
                          value={field.state.value}
                          disabled={busy}
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
                    <form.Field name="parallel">
                      {(field) => (
                        <CheckField
                          label={t("parallel")}
                          checked={field.state.value}
                          disabled={busy}
                          onChange={(event) => field.handleChange(event.currentTarget.checked)}
                          onBlur={field.handleBlur}
                        />
                      )}
                    </form.Field>
                    <form.Field name="env" mode="array">
                      {(field) => (
                        <Variables
                          label={t("variables")}
                          error={errors(field.state.meta.errors)}
                          value={field.state.value}
                          onChange={field.handleChange}
                          disabled={busy}
                        />
                      )}
                    </form.Field>
                  </Vertical>
                </FormSection>
              </ScrollArea>
              <ScrollArea
                label={t("steps")}
                h={{ base: "auto", lg: "min(65vh, 720px)" }}
                scrollbars="y"
              >
                <FormSection title={t("steps")}>
                  <form.Field name="steps" mode="array">
                    {(steps) => (
                      <Vertical>
                        {steps.state.value.map((step, index) => (
                          <FormSection
                            key={step.key}
                            title={t("stepTitle", { number: index + 1 })}
                            actions={
                              <Row>
                                <Action
                                  icon="up"
                                  intent="quiet"
                                  disabled={busy || index === 0}
                                  onClick={() => steps.swapValues(index, index - 1)}
                                >
                                  {t("moveUp")}
                                </Action>
                                <RecordAction
                                  icon="delete"
                                  label={t("removeStep")}
                                  disabled={busy}
                                  onClick={() => steps.removeValue(index)}
                                />
                              </Row>
                            }
                          >
                            <form.Field name={`steps[${index}].name`}>
                              {(field) => (
                                <TextField
                                  label={t("stepName")}
                                  aria-label={t("stepNameLabel")}
                                  value={field.state.value}
                                  disabled={busy}
                                  onChange={(event) =>
                                    field.handleChange(event.currentTarget.value)
                                  }
                                  onBlur={field.handleBlur}
                                  error={errors(field.state.meta.errors)}
                                />
                              )}
                            </form.Field>
                            <form.Field name={`steps[${index}].workdir`}>
                              {(field) => (
                                <TextField
                                  label={t("workdir")}
                                  value={field.state.value}
                                  disabled={busy}
                                  onChange={(event) =>
                                    field.handleChange(event.currentTarget.value)
                                  }
                                  onBlur={field.handleBlur}
                                  error={errors(field.state.meta.errors)}
                                />
                              )}
                            </form.Field>
                            <form.Field name={`steps[${index}].script`}>
                              {(field) => (
                                <NoteField
                                  label={t("script")}
                                  value={field.state.value}
                                  disabled={busy}
                                  onChange={(event) =>
                                    field.handleChange(event.currentTarget.value)
                                  }
                                  onBlur={field.handleBlur}
                                  error={errors(field.state.meta.errors)}
                                  clearable={false}
                                  onClear={() => field.handleChange("")}
                                />
                              )}
                            </form.Field>
                            <form.Field name={`steps[${index}].env`} mode="array">
                              {(field) => (
                                <Variables
                                  label={t("variables")}
                                  error={errors(field.state.meta.errors)}
                                  value={field.state.value}
                                  disabled={busy}
                                  onChange={field.handleChange}
                                />
                              )}
                            </form.Field>
                          </FormSection>
                        ))}
                        {errors(steps.state.meta.errors) && (
                          <Notice>{errors(steps.state.meta.errors)}</Notice>
                        )}
                        <Action
                          icon="add"
                          disabled={busy || steps.state.value.length >= 100}
                          onClick={() => steps.pushValue(newStep())}
                        >
                          {t("addStep")}
                        </Action>
                      </Vertical>
                    )}
                  </form.Field>
                </FormSection>
              </ScrollArea>
            </SectionGrid>
            <FormActions>
              <Action icon="save" type="submit" loading={busy} disabled={busy}>
                {t("save")}
              </Action>
              <Action icon="close" intent="quiet" disabled={busy} onClick={onCancel}>
                {t("cancel")}
              </Action>
            </FormActions>
          </Vertical>
        )}
      </form.Subscribe>
    </form>
  );
}
