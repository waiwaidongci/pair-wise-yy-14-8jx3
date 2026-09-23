import { useState } from "react";
import "./styles.css";
import {
  judgeRelease,
  MIN_TENT_PRESSURE_PA,
  RECHECK_INTERVAL_MS,
  REQUIRED_RECHECKS,
  SAFE_RESIDUAL_G_M3,
} from "./business/fumigationRules";
import type { ComponentRow, RelationGraph } from "./business/batchLedger";
import { useStationState } from "./business/useStationState";
import type {
  BatchStatus,
  ComponentStage,
  FumigationBatch,
  LedgerEventKind,
} from "./business/types";

const STATUS_LABEL: Record<BatchStatus, string> = {
  active: "熏蒸中",
  released: "已放行",
  rejected: "已拒绝",
  invalidated: "已失效",
};

const EVENT_LABEL: Record<LedgerEventKind, string> = {
  register: "登记",
  reuse: "沿用",
  reject: "拒绝",
  recheck: "复检",
  release: "放行",
  invalidate: "失效",
};

const STAGE_COLOR: Record<ComponentStage, string> = {
  待处理: "#64748b",
  隔离中: "#b45309",
  已放行: "#0f766e",
  待重算: "#b91c1c",
};

const STAGES: ComponentStage[] = ["待处理", "隔离中", "已放行", "待重算"];

function fmt(ts: number): string {
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getMonth() + 1}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function StageBadge({ stage }: { stage: ComponentStage }) {
  return (
    <em className="badge" style={{ color: STAGE_COLOR[stage], borderColor: STAGE_COLOR[stage] }}>
      {stage}
    </em>
  );
}

/** 隔离队列中的批次卡：复检登记 + 放行判定 */
function BatchCard({
  batch,
  codes,
  now,
  onRecheck,
  onRelease,
}: {
  batch: FumigationBatch;
  codes: string[];
  now: number;
  onRecheck: (inspector: string, frassNew: boolean, residual: number) => void;
  onRelease: () => void;
}) {
  const [inspector, setInspector] = useState("");
  const [frassNew, setFrassNew] = useState(false);
  const [residual, setResidual] = useState(0.3);
  const decision = judgeRelease(batch);
  const canRecheck = batch.rechecks.length < REQUIRED_RECHECKS;
  const last = batch.rechecks[batch.rechecks.length - 1];
  const nextEarliest = last ? last.at + RECHECK_INTERVAL_MS : null;

  return (
    <article className="batch-card">
      <header>
        <div>
          <b>{batch.id}</b>
          <span className="tent">{batch.tentId}</span>
        </div>
        <em className="status status-active">熏蒸中</em>
      </header>
      <p className="meta">
        药剂 {batch.chemicalName}（{batch.chemicalBatchNo}） · 浓度 {batch.concentration}
        g/m³ · 仓压 {batch.pressure}Pa · 施药人 {batch.applicator} · 登记于{" "}
        {fmt(batch.createdAt)}
      </p>
      <div className="chips">
        {codes.map((c) => (
          <span key={c} className="chip">
            {c}
          </span>
        ))}
      </div>

      {batch.rechecks.length > 0 && (
        <ol className="rechecks">
          {batch.rechecks.map((r, i) => (
            <li key={r.id}>
              第{i + 1}次 · {r.inspector} · {fmt(r.at)} · 蛀屑
              {r.frassNew ? "有新增" : "无新增"} · 残留 {r.residual}g/m³
            </li>
          ))}
        </ol>
      )}

      {canRecheck ? (
        <div className="recheck-form">
          <input
            placeholder="复检人（非施药人）"
            value={inspector}
            onChange={(e) => setInspector(e.target.value)}
          />
          <label className="check">
            <input
              type="checkbox"
              checked={frassNew}
              onChange={(e) => setFrassNew(e.target.checked)}
            />
            <span>蛀屑有新增</span>
          </label>
          <label className="residual">
            <span>残留浓度 g/m³</span>
            <input
              type="number"
              min={0}
              step={0.1}
              value={residual}
              onChange={(e) => setResidual(Number(e.target.value))}
            />
          </label>
          <button
            onClick={() => {
              onRecheck(inspector, frassNew, residual);
              setInspector("");
              setFrassNew(false);
            }}
          >
            登记第 {batch.rechecks.length + 1} 次复检
          </button>
        </div>
      ) : (
        <p className="hint">两次复检已完成，等待放行判定</p>
      )}

      {nextEarliest !== null && canRecheck && (
        <p className={`hint ${now >= nextEarliest ? "ok" : ""}`}>
          {now >= nextEarliest
            ? "距上次复检已满二十四小时，可登记下一次复检"
            : `下次复检须不早于 ${fmt(nextEarliest)}（间隔二十四小时）`}
        </p>
      )}

      <footer>
        {decision.ok ? (
          <button className="primary" onClick={onRelease}>
            复位放行
          </button>
        ) : (
          <>
            <button disabled>复位放行</button>
            <span className="hint">{decision.reason}</span>
          </>
        )}
      </footer>
    </article>
  );
}

/** 构件行内编辑：尺寸 / 病害 / 换件，保存即触发失效重算 */
function RowEditor({
  row,
  onSave,
  onCancel,
}: {
  row: ComponentRow;
  onSave: (section: string, disease: string, partReplaced: boolean) => void;
  onCancel: () => void;
}) {
  const [section, setSection] = useState(row.section);
  const [disease, setDisease] = useState(row.disease);
  const [partReplaced, setPartReplaced] = useState(row.partReplaced);
  return (
    <div className="row-editor">
      <label>
        <span>截面尺寸</span>
        <input value={section} onChange={(e) => setSection(e.target.value)} />
      </label>
      <label>
        <span>病害位置</span>
        <input value={disease} onChange={(e) => setDisease(e.target.value)} />
      </label>
      <label className="check">
        <input
          type="checkbox"
          checked={partReplaced}
          onChange={(e) => setPartReplaced(e.target.checked)}
        />
        <span>已换件</span>
      </label>
      <div className="row-actions">
        <button
          className="primary"
          onClick={() => onSave(section, disease, partReplaced)}
        >
          保存（触发重算）
        </button>
        <button onClick={onCancel}>取消</button>
      </div>
    </div>
  );
}

/** 单栋建筑构件关系图：从属边 + 同批熏蒸边，颜色与清单同源 */
function RelationGraphView({ graph }: { graph: RelationGraph }) {
  const colWidth = 250;
  const positions = new Map<string, { x: number; y: number }>();
  graph.buildings.forEach((b, i) => {
    positions.set(`building:${b}`, { x: 140 + i * colWidth, y: 46 });
  });
  const groups = new Map<string, string[]>();
  for (const e of graph.edges) {
    if (e.kind === "belong") {
      groups.set(e.from, [...(groups.get(e.from) ?? []), e.to]);
    }
  }
  let maxCount = 1;
  graph.buildings.forEach((b, i) => {
    const list = groups.get(`building:${b}`) ?? [];
    maxCount = Math.max(maxCount, list.length);
    list.forEach((id, k) => {
      positions.set(id, { x: 140 + i * colWidth, y: 140 + k * 66 });
    });
  });
  const width = Math.max(380, graph.buildings.length * colWidth + 30);
  const height = 180 + maxCount * 66;

  return (
    <div className="graph-wrap">
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="构件关系图">
        {graph.edges.map((e) => {
          const a = positions.get(e.from);
          const b = positions.get(e.to);
          if (!a || !b) return null;
          return (
            <line
              key={e.id}
              x1={a.x}
              y1={a.y}
              x2={b.x}
              y2={b.y}
              className={e.kind === "batch" ? "edge-batch" : "edge-belong"}
            />
          );
        })}
        {graph.nodes.map((n) => {
          const p = positions.get(n.id);
          if (!p) return null;
          if (n.kind === "building") {
            return (
              <g key={n.id}>
                <rect x={p.x - 60} y={p.y - 18} width={120} height={36} rx={8} className="node-building" />
                <text x={p.x} y={p.y + 5} textAnchor="middle" className="node-building-label">
                  {n.label}
                </text>
              </g>
            );
          }
          const color = STAGE_COLOR[n.stage ?? "待处理"];
          return (
            <g key={n.id}>
              <title>{`${n.label} · ${n.stage ?? ""}`}</title>
              <rect
                x={p.x - 72}
                y={p.y - 22}
                width={144}
                height={44}
                rx={8}
                fill="#ffffff"
                stroke={color}
                strokeWidth={2}
              />
              <text x={p.x} y={p.y - 2} textAnchor="middle" className="node-label">
                {n.label}
              </text>
              <text x={p.x} y={p.y + 14} textAnchor="middle" className="node-stage" fill={color}>
                {n.stage}
              </text>
            </g>
          );
        })}
      </svg>
      <div className="legend">
        {STAGES.map((s) => (
          <span key={s}>
            <i style={{ background: STAGE_COLOR[s] }} />
            {s}
          </span>
        ))}
        <span>
          <i className="dash" />
          同批熏蒸
        </span>
      </div>
    </div>
  );
}

function App() {
  const { state, derived, dispatch } = useStationState();
  const wallNow = () => Date.now();

  const [tentId, setTentId] = useState("仓罩T-03");
  const [chemicalBatchNo, setChemicalBatchNo] = useState(
    state.chemicals[0]?.batchNo ?? "",
  );
  const [concentration, setConcentration] = useState(10);
  const [pressure, setPressure] = useState(40);
  const [applicator, setApplicator] = useState("");
  const [picked, setPicked] = useState<string[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);

  const buildings = ["全部", ...derived.graph.buildings];
  const visibleRows =
    state.buildingFilter === "全部"
      ? derived.rows
      : derived.rows.filter((r) => r.building === state.buildingFilter);
  const codeOf = (id: string) =>
    derived.rows.find((r) => r.id === id)?.code ?? id;

  return (
    <main className="app">
      <section className="hero">
        <p>hxyfront-62013 · 源提示词8 · Port 62013</p>
        <h1>白蚁熏蒸隔离与复位放行台</h1>
        <span>
          在榫卯构件测绘台账上登记熏蒸批次：同一仓罩仅接一批、重复沿用首次；登记药剂批次、
          浓度、仓压和施药人，药剂过期或仓压不足（低于 {MIN_TENT_PRESSURE_PA}Pa）整批拒绝。
          熏蒸后由非施药人隔二十四小时复检两次，蛀屑无新增且浓度回落至{" "}
          {SAFE_RESIDUAL_G_M3}g/m³ 以下才可复位放行；处理期间修改尺寸、病害或换件，
          原放行失效重算，旧批只读。
        </span>
      </section>

      <div className="notice">{state.notice}</div>

      <section className="metrics">
        {derived.metrics.map((m) => (
          <article key={m.label}>
            <small>{m.label}</small>
            <strong>{m.value}</strong>
          </article>
        ))}
      </section>

      <section className="workspace">
        <aside className="panel">
          <h2>建筑筛选</h2>
          <div className="chips">
            {buildings.map((b) => (
              <button
                key={b}
                className={state.buildingFilter === b ? "chip-active" : ""}
                onClick={() => dispatch({ type: "filterBuilding", building: b })}
              >
                {b}
              </button>
            ))}
          </div>

          <h2>药剂批次台账</h2>
          <div className="chemical-list">
            {state.chemicals.map((c) => {
              const expired = c.expiresAt < derived.now;
              return (
                <div key={c.batchNo} className="chemical">
                  <b>{c.name}</b>
                  <span>
                    {c.batchNo} · 有效期至 {fmt(c.expiresAt)}
                  </span>
                  <em className={`badge ${expired ? "badge-danger" : "badge-ok"}`}>
                    {expired ? "已过期" : "有效"}
                  </em>
                </div>
              );
            })}
          </div>

          <h2>演示时钟</h2>
          <p className="clock">当前站台时间 {fmt(derived.now)}</p>
          <div className="chips">
            <button onClick={() => dispatch({ type: "advanceClock" })}>
              推进 24 小时
            </button>
            <button
              onClick={() => dispatch({ type: "reset", wallNow: wallNow() })}
            >
              重置演示数据
            </button>
          </div>
        </aside>

        <section className="panel form-panel">
          <div className="heading">
            <div>
              <p>同一仓罩仅接一批，重复沿用首次</p>
              <h2>登记熏蒸批次</h2>
            </div>
            <button
              className="primary"
              onClick={() => {
                dispatch({
                  type: "register",
                  wallNow: wallNow(),
                  input: {
                    tentId,
                    componentIds: picked,
                    chemicalBatchNo,
                    concentration,
                    pressure,
                    applicator,
                  },
                });
                setPicked([]);
              }}
            >
              登记入仓
            </button>
          </div>
          <div className="field-grid">
            <label>
              <span>仓罩编号</span>
              <input value={tentId} onChange={(e) => setTentId(e.target.value)} />
            </label>
            <label>
              <span>药剂批次</span>
              <select
                value={chemicalBatchNo}
                onChange={(e) => setChemicalBatchNo(e.target.value)}
              >
                {state.chemicals.map((c) => (
                  <option key={c.batchNo} value={c.batchNo}>
                    {c.name} {c.batchNo}
                    {c.expiresAt < derived.now ? "（已过期）" : ""}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>施药浓度 g/m³</span>
              <input
                type="number"
                min={0}
                step={0.5}
                value={concentration}
                onChange={(e) => setConcentration(Number(e.target.value))}
              />
            </label>
            <label>
              <span>仓压 Pa（≥{MIN_TENT_PRESSURE_PA}）</span>
              <input
                type="number"
                min={0}
                value={pressure}
                onChange={(e) => setPressure(Number(e.target.value))}
              />
            </label>
            <label>
              <span>施药人</span>
              <input
                placeholder="登记施药人"
                value={applicator}
                onChange={(e) => setApplicator(e.target.value)}
              />
            </label>
          </div>
          <p className="hint">选择入仓构件（隔离中的构件不可重复入仓）：</p>
          <div className="pick-grid">
            {visibleRows.map((row) => {
              const isolated = row.stage === "隔离中";
              return (
                <label
                  key={row.id}
                  className={`pick ${isolated ? "pick-disabled" : ""}`}
                >
                  <input
                    type="checkbox"
                    disabled={isolated}
                    checked={picked.includes(row.id)}
                    onChange={(e) =>
                      setPicked((p) =>
                        e.target.checked
                          ? [...p, row.id]
                          : p.filter((id) => id !== row.id),
                      )
                    }
                  />
                  <span>{row.code}</span>
                  <StageBadge stage={row.stage} />
                  {isolated && row.tentId ? <small>{row.tentId}</small> : null}
                </label>
              );
            })}
          </div>
        </section>
      </section>

      <section className="panel">
        <div className="heading">
          <div>
            <p>非施药人复检 · 两次 · 间隔二十四小时</p>
            <h2>隔离队列（{derived.queue.length}）</h2>
          </div>
        </div>
        {derived.queue.length === 0 && (
          <p className="hint">当前无处理期间的批次，可在上方登记入仓。</p>
        )}
        <div className="queue-grid">
          {derived.queue.map((b) => (
            <BatchCard
              key={b.id}
              batch={b}
              codes={b.componentIds.map(codeOf)}
              now={derived.now}
              onRecheck={(inspector, frassNew, residual) =>
                dispatch({
                  type: "recheck",
                  batchId: b.id,
                  inspector,
                  frassNew,
                  residual,
                  wallNow: wallNow(),
                })
              }
              onRelease={() =>
                dispatch({ type: "release", batchId: b.id, wallNow: wallNow() })
              }
            />
          ))}
        </div>

        {derived.history.length > 0 && (
          <>
            <h3 className="subhead">历史批次（旧批只读）</h3>
            <div className="history">
              {derived.history.map((b) => (
                <article key={b.id} className="history-item">
                  <b>{b.id}</b>
                  <span>{b.tentId}</span>
                  <em className={`status status-${b.status}`}>
                    {STATUS_LABEL[b.status]}
                  </em>
                  <i className="readonly">只读</i>
                  <p>{b.note || "—"}</p>
                  <small>
                    登记 {fmt(b.createdAt)}
                    {b.releasedAt ? ` · 放行 ${fmt(b.releasedAt)}` : ""} · 施药人{" "}
                    {b.applicator}
                  </small>
                </article>
              ))}
            </div>
          </>
        )}
      </section>

      <section className="panel">
        <div className="heading">
          <div>
            <p>尺寸 / 病害 / 换件变更 → 原放行失效重算</p>
            <h2>构件清单</h2>
          </div>
        </div>
        <div className="component-rows">
          {visibleRows.map((row) => (
            <article key={row.id} className="component-row">
              <div className="row-main">
                <b>{row.code}</b>
                <span>
                  {row.building} · {row.wood} · {row.jointType} · 截面 {row.section}
                </span>
                <span>
                  病害：{row.disease} · 变形：{row.deformation}
                  {row.partReplaced ? " · 已换件" : ""} · 建议：{row.suggestion}
                </span>
                <small>
                  测绘版本 v{row.revision}
                  {row.batchId ? ` · 最近批次 ${row.batchId}（${row.tentId}）` : ""}
                </small>
              </div>
              <div className="row-side">
                <StageBadge stage={row.stage} />
                <button
                  onClick={() =>
                    setEditingId(editingId === row.id ? null : row.id)
                  }
                >
                  {editingId === row.id ? "收起" : "修改"}
                </button>
              </div>
              {editingId === row.id && (
                <RowEditor
                  row={row}
                  onCancel={() => setEditingId(null)}
                  onSave={(section, disease, partReplaced) => {
                    dispatch({
                      type: "revise",
                      componentId: row.id,
                      section,
                      disease,
                      partReplaced,
                      wallNow: wallNow(),
                    });
                    setEditingId(null);
                  }}
                />
              )}
            </article>
          ))}
        </div>
      </section>

      <section className="panel">
        <div className="heading">
          <div>
            <p>清单 / 隔离队列 / 关系图同源派生，刷新后一致</p>
            <h2>单栋建筑构件关系图</h2>
          </div>
        </div>
        <RelationGraphView graph={derived.graph} />
      </section>

      <section className="panel">
        <div className="heading">
          <div>
            <p>批次账流水 · 只追加不篡改</p>
            <h2>批次账</h2>
          </div>
        </div>
        <div className="events">
          {derived.events.map((e) => (
            <article key={e.id}>
              <em className={`event event-${e.kind}`}>{EVENT_LABEL[e.kind]}</em>
              <div>
                <b>
                  {e.batchId} · {e.tentId}
                </b>
                <p>{e.detail}</p>
              </div>
              <time>{fmt(e.at)}</time>
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}

export default App;
