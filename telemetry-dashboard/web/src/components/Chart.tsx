import ReactECharts from "echarts-for-react";

const AXIS = "#9aa3ad";
const SPLIT = "#242a33";

// Base theme shared by every chart so they match the dark UI.
// `option` is intentionally loose — we assemble many ad-hoc ECharts configs.
export function Chart({ option, height = 280, onEvents }: { option: any; height?: number; onEvents?: Record<string, (p: any) => void> }) {
  const merged: any = {
    backgroundColor: "transparent",
    textStyle: { color: AXIS, fontFamily: "Inter, sans-serif" },
    grid: { left: 44, right: 18, top: 28, bottom: 28, ...(option.grid as any) },
    tooltip: { trigger: "axis", backgroundColor: "#181c22", borderColor: SPLIT, textStyle: { color: "#e8eaed" }, ...(option.tooltip as any) },
    ...option,
  };
  return (
    <ReactECharts
      option={merged}
      style={{ height }}
      notMerge
      lazyUpdate
      onEvents={onEvents}
      opts={{ renderer: "canvas" }}
    />
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
