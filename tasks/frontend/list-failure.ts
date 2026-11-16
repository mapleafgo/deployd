import { useState } from "react";

/** 同一查询复查时保留未解决错误；切换条件或收到最终新结果时结束旧错误展示。 */
export function useListFailure(error: Error | null, loading: boolean, requestKey: string) {
  const [previous, setPrevious] = useState({ requestKey, error });
  // Query 在无数据时重新请求会先清空 error；开始请求不等于故障已经恢复。
  const presented =
    error ?? (loading && previous.requestKey === requestKey ? previous.error : null);
  if (previous.requestKey !== requestKey || previous.error !== presented) {
    setPrevious({ requestKey, error: presented });
  }
  return presented;
}
