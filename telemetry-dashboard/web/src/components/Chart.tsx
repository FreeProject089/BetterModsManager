import { useEffect, useRef } from "react";
import ReactECharts from "echarts-for-react";

const AXIS = "#9aa3ad";
const SPLIT = "#242a33";

// Base theme shared by every chart so they match the dark UI.
// `option` is intentionally loose — we assemble many ad-hoc ECharts configs.
export function Chart({ option, height = 280, onEvents }: { option: any; height?: number; onEvents?: Record<string, (p: any) => void> }) {
  const ref = useRef<ReactECharts>(null);
  const box = useRef<HTMLDivElement>(null);

  // ECharts doesn't resize when only its container changes (sidebar collapse,
  // tab switch, flex reflow) — this is the usual "chart doesn't show / wrong
  // size" cause. A ResizeObserver fixes it.
  useEffect(() => {
    if (!box.current) return;
    const ro = new ResizeObserver(() => {
      try { ref.current?.getEchartsInstance().resize(); } catch {}
    });
    ro.observe(box.current);
    return () => ro.disconnect();
  }, []);

  const merged: any = {
    backgroundColor: "transparent",
    textStyle: { color: AXIS, fontFamily: "Inter, sans-serif" },
    grid: { left: 44, right: 18, top: 28, bottom: 28, ...(option.grid as any) },
    tooltip: { trigger: "axis", backgroundColor: "#181c22", borderColor: SPLIT, textStyle: { color: "#e8eaed" }, ...(option.tooltip as any) },
    ...option,
  };
  return (
    <div ref={box} style={{ width: "100%" }}>
      <ReactECharts
        ref={ref}
        option={merged}
        style={{ height, width: "100%" }}
        notMerge
        lazyUpdate
        onEvents={onEvents}
        opts={{ renderer: "canvas" }}
      />
    </div>
  );
}

export const axisX = (data: any[]) => ({
  type: "category" as const,
  data,
  axisLine: { lineStyle: { color: SPLIT } },
  axisLabel: { color: AXIS, fontSize: 11 },
  axisTick: { show: false },
});
export const axisY = (opts: any = {}) => ({
  type: "value" as const,
  splitLine: { lineStyle: { color: SPLIT } },
  axisLabel: { color: AXIS, fontSize: 11 },
  ...opts,
});
