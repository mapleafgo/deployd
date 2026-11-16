import { safeFailure, failureText, type SafeFailure } from "./errors";
import { useEffect, useRef, useState } from "react";
import { useAuth } from "@red-berry-kit/auth";
import {
  Action,
  CheckField,
  LogViewport,
  Notice,
  Row,
  StatusTag,
  Vertical,
} from "@red-berry-kit/ui";
import { useTasksContext } from "./module";
import { LogBuffer, readEvents, terminal } from "./log-stream";
import { streamResponse, renewLogAccess } from "./stream-auth";
import { useTasksTranslation } from "./use-translation";
function delay(signal: AbortSignal) {
  return new Promise<void>((resolve) => {
    const end = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", end);
      resolve();
    };
    const timer = setTimeout(end, 1000);
    signal.addEventListener("abort", end, { once: true });
    if (signal.aborted) end();
  });
}
export function RunLog(props: {
  id: string;
  enabled?: boolean;
  onCompleted: () => void;
  onCancelAccepted: () => void;
}) {
  const { state } = useAuth();
  const account = state.account;
  // 关闭动画可以保留日志，但身份变化不可以保留上一身份的敏感视图。
  if (!account) return null;
  return (
    <RunLogContent
      key={JSON.stringify([account.source, account.id, account.session_id])}
      {...props}
    />
  );
}
function RunLogContent({
  id,
  enabled = true,
  onCompleted,
  onCancelAccepted,
}: {
  id: string;
  enabled?: boolean;
  onCompleted: () => void;
  onCancelAccepted: () => void;
}) {
  const { session } = useAuth();
  const { api, i18n } = useTasksContext();
  const { t } = useTasksTranslation();
  const [text, setText] = useState("");
  const [status, setStatus] = useState("queued");
  const [connection, setConnection] = useState("connecting");
  const [streamFailure, setStreamFailure] = useState<SafeFailure | null>(null);
  const [cancelFailure, setCancelFailure] = useState<SafeFailure | null>(null);
  const [follow, setFollow] = useState(true);
  const [truncated, setTruncated] = useState(false);
  const [busy, setBusy] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const callbacksRef = useRef({ onCompleted, onCancelAccepted });
  useEffect(() => {
    callbacksRef.current = { onCompleted, onCancelAccepted };
  }, [onCompleted, onCancelAccepted]);
  const bufferRef = useRef({ id, buffer: new LogBuffer() });
  useEffect(() => {
    if (!enabled) return;
    if (bufferRef.current.id !== id) bufferRef.current = { id, buffer: new LogBuffer() };
    const buffer = bufferRef.current.buffer;
    const controller = new AbortController();
    let ended = false;
    let failures = 0;
    setText(buffer.text);
    setStatus("queued");
    setCancelFailure(null);
    async function connect() {
      while (!controller.signal.aborted && !ended) {
        let responseRequestId: string | undefined;
        try {
          setConnection(buffer.offset ? "reconnecting" : "connecting");
          const response = await session.request(
            async (options) => {
              const headers = new Headers(options.headers);
              headers.set("Accept", "text/event-stream");
              headers.set("Accept-Language", i18n.resolvedLanguage ?? "zh-CN");
              const result = await fetch(api.getStreamRunLogUrl(id, { offset: buffer.offset }), {
                ...options,
                headers,
                cache: "no-store",
              });
              return streamResponse(result);
            },
            { signal: controller.signal },
          );
          responseRequestId = response.headers.get("X-Request-ID") ?? undefined;
          if (controller.signal.aborted) {
            await response.body?.cancel();
            return;
          }
          if (!response.body) throw new Error("streamFailed");
          setConnection("connected");
          await readEvents(response.body, (event) => {
            if (controller.signal.aborted) return;
            if (event.type === "error")
              throw new Error(
                event.value.code === "loginRequired" ? "loginRequired" : "streamFailed",
              );
            if (event.type === "log") {
              if (typeof event.value.data !== "string" || typeof event.value.offset !== "number")
                throw new Error("streamFailed");
              buffer.append(event.value.data, event.value.offset);
              setText(buffer.text);
              setTruncated(buffer.truncated);
            } else if (event.type === "status" && typeof event.value.status === "string") {
              setStatus(event.value.status);
              if (terminal(event.value.status)) {
                buffer.finish();
                setText(buffer.text);
                ended = true;
                setConnection("complete");
                callbacksRef.current.onCompleted();
              }
            }
            failures = 0;
            setStreamFailure(null);
          });
        } catch (error) {
          if (controller.signal.aborted) return;
          if (error instanceof Error && error.message === "loginRequired") {
            try {
              await renewLogAccess(session);
            } catch (renewalError) {
              if (!controller.signal.aborted) setStreamFailure(safeFailure(renewalError));
              setConnection("disconnected");
              return;
            }
          }
          const failure = safeFailure(error, responseRequestId);
          setStreamFailure(failure);
          failures++;
          if (
            !session.snapshot().account ||
            failures >= 5 ||
            (typeof error === "object" &&
              error !== null &&
              "status" in error &&
              [404, 422].includes(Number(error.status)))
          ) {
            setConnection("disconnected");
            return;
          }
        }
        if (!ended && !controller.signal.aborted) {
          setConnection("reconnecting");
          await delay(controller.signal);
        }
      }
    }
    void connect();
    return () => controller.abort();
  }, [id, enabled, session, api, i18n, attempt]);
  return (
    <Vertical>
      <Row>
        <StatusTag
          tone={
            status === "success"
              ? "success"
              : ["failed", "timeout"].includes(status)
                ? "danger"
                : terminal(status)
                  ? "neutral"
                  : "warning"
          }
        >
          {t(`status.${status}`)}
        </StatusTag>
        <span>{t(connection)}</span>
        {!terminal(status) && (
          <Action
            icon="disable"
            intent="danger"
            disabled={busy}
            loading={busy}
            onClick={() => {
              setBusy(true);
              void api
                .cancelRun(id)
                .then(() => {
                  setCancelFailure(null);
                  callbacksRef.current.onCancelAccepted();
                })
                .catch((error) => setCancelFailure(safeFailure(error)))
                .finally(() => setBusy(false));
            }}
          >
            {t("cancelRun")}
          </Action>
        )}
      </Row>
      {cancelFailure && (
        <Notice>{t("cancelFailed", { reason: failureText(cancelFailure, t) })}</Notice>
      )}
      {streamFailure && <Notice>{failureText(streamFailure, t)}</Notice>}
      {connection === "disconnected" && (
        <Action icon="refresh" onClick={() => setAttempt((value) => value + 1)}>
          {t("retryLog")}
        </Action>
      )}
      {truncated && <Notice>{t("logTruncated")}</Notice>}
      <CheckField
        label={t("followLog")}
        checked={follow}
        onChange={(event) => setFollow(event.currentTarget.checked)}
      />
      <LogViewport value={text} follow={follow} label={t("viewLog")} height="min(60vh, 640px)" />
    </Vertical>
  );
}
