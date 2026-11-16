export type SafeFailure = { code: string; requestId?: string };
function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}
export function safeFailure(error: unknown, fallbackRequestId?: string): SafeFailure {
  const value: Record<string, unknown> = {
    ...record(error),
    requestId: record(error).requestId ?? fallbackRequestId,
  };
  const code =
    value.status === 401
      ? "loginRequired"
      : value.status === 403
        ? "forbidden"
        : value.status === 409
          ? "conflict"
          : value.status === 422
            ? "invalidInput"
            : error instanceof Error && ["loginRequired", "streamFailed"].includes(error.message)
              ? error.message
              : "requestFailed";
  const requestId =
    typeof value.requestId === "string" &&
    value.requestId.length >= 1 &&
    value.requestId.length <= 128 &&
    !/[^a-zA-Z0-9_./:-]/.test(value.requestId)
      ? value.requestId
      : undefined;
  return { code, ...(requestId ? { requestId } : {}) };
}
export function failureText(value: SafeFailure, translate: (key: string) => string) {
  return translate(value.code) + (value.requestId ? ` · ${value.requestId}` : "");
}
type StepField = `steps[${number}].${"name" | "workdir" | "script" | "env"}`;
type Field =
  | "name"
  | "description"
  | "workdir"
  | "timeout"
  | "queue"
  | "parallel"
  | "env"
  | StepField;
export function submitErrors(error: unknown, submittedKeys: string[], currentKeys: string[]) {
  const root = record(error);
  const body = record(root.info ?? root.body ?? root.data);
  const fields: Partial<Record<Field, string[]>> = {};
  const form: string[] = [];
  const reasonCodes = new Set([
    "timeoutRange",
    "absoluteWorkdir",
    "workdirTooLong",
    "noNul",
    "envName",
    "nonBlank",
    "taskName",
    "descriptionLength",
    "stepNameLength",
    "stepsCount",
    "commandsCount",
    "queuePolicy",
    "requiredField",
    "invalidField",
  ]);
  const addForm = (reason: string) => {
    if (!form.includes(reason)) form.push(reason);
  };
  const addField = (field: Field, reason: string) => {
    const reasons = (fields[field] ??= []);
    if (!reasons.includes(reason)) reasons.push(reason);
  };
  const details = Array.isArray(body.errors) ? body.errors : [];
  for (const item of details) {
    const detail = record(item);
    const location = detail.location;
    const reason =
      typeof detail.code === "string" && reasonCodes.has(detail.code)
        ? `validation.${detail.code}`
        : "invalidInput";
    if (typeof location !== "string") {
      addForm(reason);
      continue;
    }
    const path = location.replace(/^body\./, "");
    if (
      path === "name" ||
      path === "description" ||
      path === "workdir" ||
      path === "timeout" ||
      path === "queue" ||
      path === "parallel"
    ) {
      addField(path, reason);
      continue;
    }
    if (path === "env" || path.startsWith("env.")) {
      addField("env", reason);
      continue;
    }
    const match =
      /^steps(?:\[(\d+)\]|\.(\d+))\.(name|workdir|commands|env)(?:\[\d+\]|\.[A-Za-z_][A-Za-z0-9_]*)?$/.exec(
        path,
      );
    if (match) {
      const key = submittedKeys[Number(match[1] ?? match[2])];
      const index = key === undefined ? -1 : currentKeys.indexOf(key);
      const part = match[3] === "commands" ? "script" : match[3];
      if (
        index >= 0 &&
        (part === "name" || part === "workdir" || part === "script" || part === "env")
      )
        addField(`steps[${index}].${part}`, reason);
      else addForm(reason);
      continue;
    }
    addForm(reason);
  }
  if (!details.length) addForm(safeFailure(error).code);
  return { form, fields };
}
