// 构件关系视图：建筑 → 榫卯构件 → 熏蒸仓罩/批次 的关系图
// 节点颜色与清单/队列共用同一状态派生口径，刷新后三处一致。

import { useMemo, useState } from "react";
import { PHASE_LABEL, ComponentPhase } from "../fumigation/rules";
import { useStation } from "../fumigation/station";

const NODE_W = 172;
const NODE_H = 64;
const TENT_H = 56;
const COL_X = [60, 360, 660];
const ROW_H = 92;

const phaseFill: Record<ComponentPhase, string> = {
  untreated: "#e8edf4",
  fumigating: "#f6e2c4",
  "await-recheck": "#fbeecf",
  "await-second": "#fbeecf",
  released: "#d7efe8",
  recalculate: "#f4d7d7",
  rejected: "#f4d7d7",
};

export function GraphView() {
  const { state, componentPhase, componentBatch, gotoBatch, tentName } = useStation();
  const [building, setBuilding] = useState<string>("全部");

  const buildings = useMemo(
    () => Array.from(new Set(state.components.map((c) => c.building))),
    [state.components],
  );

  const rows = useMemo(() => {
    const comps = state.components.filter(
      (c) => building === "全部" || c.building === building,
    );
    return comps.map((c) => {
      const phase = componentPhase(c.id);
      const batch = componentBatch(c.id);
      return { c, phase, batch };
    });
  }, [state.components, building, componentPhase, componentBatch]);

  const height = Math.max(260, rows.length * ROW_H + 140);

  const edges = rows
    .filter((r) => r.batch)
    .map((r, i) => {
      const y = 40 + i * ROW_H;
      const batch = r.batch!;
      // 同罩批次归并到同一 y 槽（仅熏蒸中画实线指向占用仓罩）
      const active = batch.status === "fumigating";
      return {
        key: r.c.id + batch.id,
        x1: COL_X[1] + NODE_W,
        y1: y + NODE_H / 2,
        x2: COL_X[2],
        y2: y + TENT_H / 2,
        active,
        dashed: !active,
        status: batch.status,
      };
    });

  // 仓罩节点（只画与当前构件相关的）
  const tentNodes = useMemo(() => {
    const map = new Map<string, { y: number; active: boolean; batchId: string; status: string }>();
    rows.forEach((r, i) => {
      if (!r.batch) return;
      const y = 40 + i * ROW_H;
      const prev = map.get(r.batch.tentId);
      const active = r.batch.status === "fumigating";
      if (!prev || (active && !prev.active)) {
        map.set(r.batch.tentId, {
          y,
          active,
          batchId: r.batch.id,
          status: r.batch.status,
        });
      }
    });
    return Array.from(map.entries()).map(([tentId, v]) => ({ tentId, ...v }));
  }, [rows]);

  return (
    <div className="view">
      <div className="toolbar">
        <div className="chips small">
          {["全部", ...buildings].map((b) => (
            <button
              key={b}
              className={building === b ? "chip-on" : ""}
              onClick={() => setBuilding(b)}
            >
              {b}
            </button>
          ))}
        </div>
        <div className="legend">
          <i className="lg" style={{ background: phaseFill.untreated }} />未熏蒸
          <i className="lg" style={{ background: phaseFill.fumigating }} />熏蒸中
          <i className="lg" style={{ background: phaseFill["await-recheck"] }} />待复检
          <i className="lg" style={{ background: phaseFill.released }} />已放行
          <i className="lg" style={{ background: phaseFill.recalculate }} />失效/拒绝
        </div>
      </div>

      <div className="card graph-card">
        <svg viewBox={`0 0 960 ${height}`} className="graph-svg" role="img" aria-label="构件熏蒸关系图">
          {/* 列标题 */}
          <text x={COL_X[0]} y={22} className="col-title">建筑</text>
          <text x={COL_X[1]} y={22} className="col-title">榫卯构件</text>
          <text x={COL_X[2]} y={22} className="col-title">仓罩 / 最近批次</text>

          {rows.map((r, i) => {
            const y = 40 + i * ROW_H;
            const buildingName = r.c.building;
            const showBuilding =
              i === 0 || rows[i - 1].c.building !== buildingName;
            const buildingCount = state.components.filter(
              (c) => c.building === buildingName,
            ).length;
            const buildingIndex = state.components
              .filter((c) => c.building === buildingName)
              .indexOf(r.c);
            const bHeight = buildingCount * ROW_H - 28;
            const bY = y - buildingIndex * ROW_H;

            return (
              <g key={r.c.id}>
                {showBuilding && (
                  <g>
                    <rect
                      x={COL_X[0]}
                      y={bY}
                      width={NODE_W + 40}
                      height={bHeight}
                      rx={10}
                      className="building-box"
                    />
                    <text x={COL_X[0] + 16} y={bY + 28} className="building-name">
                      {buildingName}
                    </text>
                    <text x={COL_X[0] + 16} y={bY + 48} className="building-sub">
                      {buildingCount} 件 · 榫卯组
                    </text>
                  </g>
                )}

                {/* 建筑 → 构件 连接 */}
                <line
                  x1={COL_X[0] + NODE_W + 40}
                  y1={y + NODE_H / 2}
                  x2={COL_X[1]}
                  y2={y + NODE_H / 2}
                  className="link-static"
                />

                {/* 构件节点 */}
                <rect
                  x={COL_X[1]}
                  y={y}
                  width={NODE_W}
                  height={NODE_H}
                  rx={8}
                  className="node-rect"
                  fill={phaseFill[r.phase]}
                />
                <text x={COL_X[1] + 12} y={y + 24} className="node-code">{r.c.code}</text>
                <text x={COL_X[1] + 12} y={y + 44} className="node-sub">
                  {r.c.joint} · {r.c.id}
                </text>
                <text x={COL_X[1] + NODE_W - 10} y={y + 20} className="node-phase" textAnchor="end">
                  {PHASE_LABEL[r.phase]}
                </text>
              </g>
            );
          })}

          {/* 构件 → 仓罩 边 */}
          {edges.map((e) => {
            const mx = (e.x1 + e.x2) / 2;
            const color = e.active ? "#854d0e" : "#9aa6b4";
            return (
              <g key={e.key}>
                <path
                  d={`M ${e.x1} ${e.y1} C ${mx} ${e.y1}, ${mx} ${e.y2}, ${e.x2} ${e.y2}`}
                  fill="none"
                  stroke={color}
                  strokeWidth={e.active ? 2 : 1.4}
                  strokeDasharray={e.dashed ? "5 5" : undefined}
                />
                <polygon
                  points={`${e.x2},${e.y2} ${e.x2 - 9},${e.y2 - 5} ${e.x2 - 9},${e.y2 + 5}`}
                  fill={color}
                />
              </g>
            );
          })}

          {/* 仓罩节点 */}
          {tentNodes.map((t) => {
            const y = t.y;
            const fill = t.active ? "#854d0e" : "#eef2f7";
            const txt = t.active ? "#fff" : "#526071";
            return (
              <g
                key={t.tentId}
                className="tent-node"
                onClick={() => gotoBatch(t.batchId, t.active ? "queue" : "ledger")}
              >
                <rect
                  x={COL_X[2]}
                  y={y}
                  width={240}
                  height={TENT_H}
                  rx={8}
                  fill={fill}
                  stroke={t.active ? "#6d3f0c" : "#c7d2df"}
                />
                <text x={COL_X[2] + 12} y={y + 22} fill={txt} className="tent-name">
                  {t.tentId} · {tentName(t.tentId)}
                </text>
                <text x={COL_X[2] + 12} y={y + 42} fill={txt} className="tent-sub">
                  {t.batchId} · {statusText(t.status)}
                </text>
              </g>
            );
          })}
        </svg>
      </div>

      <p className="rule-note">
        实线：构件正在该仓罩熏蒸（点击进入隔离队列复检）；虚线：最近批次已放行 / 拒绝 / 作废（点击进入只读台账）。
        节点颜色、批次归属与构件清单、隔离队列来自同一份批次账，刷新后保持一致。
      </p>
    </div>
  );
}

function statusText(status: string): string {
  switch (status) {
    case "fumigating":
      return "熏蒸中";
    case "released":
      return "已复位放行";
    case "rejected":
      return "整批拒绝";
    case "invalidated":
      return "作废重算";
    default:
      return status;
  }
}
