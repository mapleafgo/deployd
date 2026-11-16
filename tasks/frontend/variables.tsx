import {
  Action,
  FormSection,
  Notice,
  RecordAction,
  Row,
  TextField,
  Vertical,
} from "@red-berry-kit/ui";
import { type Variable, variablesSchema } from "./editor-model";
import { useTasksTranslation } from "./use-translation";
export function Variables({
  value,
  onChange,
  disabled,
  label,
  error: submissionError,
  inheritedNames = [],
}: {
  value: Variable[];
  onChange: (rows: Variable[]) => void;
  disabled: boolean;
  label: string;
  error?: string | undefined;
  inheritedNames?: string[];
}) {
  const { t } = useTasksTranslation();
  const result = variablesSchema.safeParse(value);
  const error = (index: number, key: "key" | "value") =>
    result.success
      ? undefined
      : result.error.issues
          .filter((issue) => issue.path[0] === index && issue.path[1] === key)
          .map((issue) => t(issue.message))
          .join("; ") || undefined;
  return (
    <FormSection title={label}>
      <Vertical>
        {submissionError && <Notice>{submissionError}</Notice>}
        {value.map((row, index) => (
          <Vertical key={index}>
            {inheritedNames.includes(row.key) && <Notice>{t("overridesTaskVariable")}</Notice>}
            <Row>
              <TextField
                label={t("variableName")}
                aria-label={t("variableNameLabel")}
                value={row.key}
                disabled={disabled}
                error={error(index, "key")}
                onChange={(event) =>
                  onChange(
                    value.map((item, i) =>
                      i === index ? { ...item, key: event.currentTarget.value } : item,
                    ),
                  )
                }
              />
              <TextField
                label={t("variableValue")}
                aria-label={t("variableValueLabel")}
                value={row.value}
                disabled={disabled}
                onChange={(event) =>
                  onChange(
                    value.map((item, i) =>
                      i === index ? { ...item, value: event.currentTarget.value } : item,
                    ),
                  )
                }
              />
              <RecordAction
                icon="delete"
                label={t("removeVariable")}
                disabled={disabled}
                onClick={() => onChange(value.filter((_, i) => i !== index))}
              />
            </Row>
          </Vertical>
        ))}
        <Action
          icon="add"
          intent="quiet"
          disabled={disabled}
          onClick={() => onChange([...value, { key: "", value: "" }])}
        >
          {t("addVariable")}
        </Action>
      </Vertical>
    </FormSection>
  );
}
