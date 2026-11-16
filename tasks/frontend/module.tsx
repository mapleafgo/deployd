import { createContext, useContext, type ReactNode } from "react";
import type { i18n as I18n } from "i18next";
import type { QueryClient } from "@tanstack/react-query";
export type Step = {
  name: string;
  workdir: string;
  env: Record<string, string>;
  commands: string[];
};
export type TaskInput = {
  description: string;
  workdir: string;
  timeout: string;
  /** 同名运行的调度策略；字段名遵循公开 JSON 协议。 */
  queue: "wait" | "terminate";
  parallel: boolean;
  env: Record<string, string>;
  steps: Step[];
};
export type Task = TaskInput & { name: string; token: string; updated_at: string };
export type Run = {
  id: string;
  /** 所属任务名称；字段名遵循公开 JSON 协议。 */
  name: string;
  status: string;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
};
export type PageResult<T> = { items: T[]; page: number; size: number; total: number };
export type Search = { page: number; size: number; q: string; name?: string };
type RequestClient = <T>(url: string, options?: RequestInit) => Promise<T>;
/** 结构化公开协议由 CLI 以实际生成客户端检查，不引用应用生成目录。 */
export type ModuleContext = {
  api: {
    listTasks: (params?: Search, options?: RequestInit) => Promise<PageResult<Task>>;
    createTask: (data: TaskInput & { name: string }, options?: RequestInit) => Promise<Task>;
    updateTask: (name: string, data: TaskInput, options?: RequestInit) => Promise<Task>;
    deleteTask: (name: string, options?: RequestInit) => Promise<unknown>;
    triggerTask: (
      name: string,
      data: { env: Record<string, string> },
      options?: RequestInit,
    ) => Promise<Run>;
    listRuns: (params?: Search, options?: RequestInit) => Promise<PageResult<Run>>;
    cancelRun: (id: string, options?: RequestInit) => Promise<unknown>;
    getStreamRunLogUrl: (id: string, params?: { offset?: number }) => string;
  };
  i18n: I18n;
  queryClient: QueryClient;
  scope: string;
  http: { use: (middleware: (next: RequestClient) => RequestClient) => () => void };
};
const Context = createContext<ModuleContext | null>(null);
export function createProvider(context: ModuleContext) {
  return function TasksProvider({ children }: { children: ReactNode }) {
    return <Context.Provider value={context}>{children}</Context.Provider>;
  };
}
export function useTasksContext() {
  const value = useContext(Context);
  if (!value) throw new Error("tasks provider missing");
  return value;
}
