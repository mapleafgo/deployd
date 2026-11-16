import { useState } from "react";

/** 打开意图由调用方（包括 Router URL）持有；快照仅服务退出动画，不决定是否打开。 */
export function useExitPresentation<T>(selected: T | undefined) {
  const [snapshot, setSnapshot] = useState({ selected, value: selected });
  if (snapshot.selected !== selected) {
    setSnapshot({ selected, value: selected === undefined ? snapshot.value : selected });
  }
  return {
    value: snapshot.value,
    onClosed: () => {
      // 每次意图变化产生独立快照；旧动画完成事件不能清理快速重开的对象。
      setSnapshot((current) =>
        current === snapshot && current.selected === undefined
          ? { selected: undefined, value: undefined }
          : current,
      );
    },
  };
}
