// 构件清单视图：测绘字段维护 + 状态标记
// 关键规则体现：修改截面尺寸 / 病害 / 换件为关键变更，会使在处理/已放行批次作废重算（旧批只读）

import { useEffect, useMemo, useState } from "react";
import {
  DOSE_RANGE,
  MIN_PRESSURE,
  PHASE_LABEL,
  SAFE_RESIDUAL_PPM,
  formatDateTime,
  isReadOnly,
} from "../fumigation/rules";
import { useStation } from "../fumigation/station";
import type { Component } from "../fumigation/rules";

const JOINTS = ["燕尾榫", "透榫", "半榫", "箍头榫", "管脚榫"];

const phaseClass: Record<string, string> = {
  untreated: "ph-untreated",
  fumigating: "ph-fum",
  "await-recheck": "ph-wait",
  "await-second": "ph-wait",
  released: "ph-ok",
  recalculate: "ph-bad",
  rejected: "ph-bad",
};

export function ComponentList() {
  const {
    state,
    now,
    focusComponentId,
    gotoBatch,
    gotoComponent,
    componentPhase,
    componentBatch,
    patchComponent,
    createComponent,
  } = useStation();
  const [jointFilter, setJointFilter] = useState<string>("全部");
  const [phaseFilter, setPhaseFilter] = useState<string>("全部");
  const [editingId, setEditingId] = useState<string | null>(focusComponentId);
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    if (focusComponentId) setEditingId(focusComponentId);
  }, [focusComponentId]);

  const joints = useMemo(
    () => ["全部", ...new Set(state.components.map((c) => c.joint))],
    [state.components],
  );
  const phases = ["全部", "untreated", "fumigating", "await-recheck", "await-second", "released", "recalculate", "rejected"];

  const rows = state.components.filter(
    (c) =>
      (jointFilter === "全部" || c.joint === jointFilter) &&
      (phaseFilter === "全部" || componentPhase(c.id) === phaseFilter),
  );

  return (
    <div className="view">
      <div className="toolbar">
        <div className="filter-row">
          <span>榫卯类型</span>
          <div className="chips small">
            {joints.map((j) => (
              <button
                key={j}
                className={jointFilter === j ? "chip-on" : ""}
                onClick={() => setJointFilter(j)}
              >
                {j}
              </button>
            ))}
          </div>
        </div>
        <div className="filter-row">
          <span>处置状态</span>
          <div className="chips small">
            {phases.map((p) => (
              <button
                key={p}
                className={phaseFilter === p ? "chip-on" : ""}
                onClick={() => setPhaseFilter(p)}
              >
                {p === "全部" ? "全部" : PHASE_LABEL[p as keyof typeof PHASE_LABEL]}
              </button>
            ))}
          </div>
        </div>
        <button className="primary" onClick={() => setAdding(true)}>
          新增测绘构件
        </button>
      </div>

      <div className="card-table">
        <table>
          <thead>
            <tr>
              <th>构件编号</th>
              <th>建筑</th>
              <th>木种 / 榫卯</th>
              <th>截面尺寸</th>
              <th>病害（蛀屑）</th>
              <th>状态</th>
              <th>最近批次</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => {
              const phase = componentPhase(c.id);
              const batch = componentBatch(c.id);
              const locked = batch?.status === "fumigating";
              return (
                <tr key={c.id} id={`cp-${c.id}`}>
                  <td>
                    <b>{c.code}</b>
                    <small>{c.id} · rev.{c.revision}{c.replaced ? " · 换件" : ""}</small>
                  </td>
                  <td>{c.building}</td>
                  <td>
                    {c.wood}
                    <small>{c.joint}</small>
                  </td>
                  <td className={locked ? "cell-warn" : ""}>{c.section}</td>
                  <td className={locked ? "cell-warn" : ""}>
                    {c.disease}
                    {c.replaced && <em className="tag-replace">已换件</em>}
                  </td>
                  <td>
                    <span className={`phase ${phaseClass[phase]}`}>{PHASE_LABEL[phase]}</span>
                  </td>
                  <td>
                    {batch ? (
                      <button className="link" onClick={() => gotoBatch(batch.id, "ledger")}>
                        {batch.id}
                      </button>
                    ) : (
                      <span className="muted">—</span>
                    )}
                  </td>
                  <td>
                    <button
                      onClick={() => {
                        setEditingId(editingId === c.id ? null : c.id);
                        gotoComponent(c.id);
                      }}
                    >
                      {editingId === c.id ? "收起" : "测绘/修改"}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {adding && (
        <AddComponentCard
          onClose={() => setAdding(false)}
          onSubmit={(draft) => {
            const id = createComponent(draft);
            setAdding(false);
            gotoComponent(id);
            setEditingId(id);
          }}
        />
      )}

      {editingId &&
        rows.find((c) => c.id === editingId) &&
        (() => {
          const c = state.components.find((x) => x.id === editingId)!;
          return (
            <EditComponentCard
              key={c.id + c.revision}
              component={c}
              now={now}
              onClose={() => setEditingId(null)}
              onSave={(patch) => patchComponent(c.id, patch)}
              onOpenBatch={(id) => gotoBatch(id, "ledger")}
            />
          );
        })()}

      <p className="rule-note">
        规则提示：熏蒸处理期间修改<span className="k">截面尺寸 / 病害记录 / 换件</span>
        为关键变更，正在熏蒸或已放行的批次将<span className="k">作废重算、旧批只读封存</span>
        （残留阈值 ≤{SAFE_RESIDUAL_PPM}ppm，施药浓度建议 {DOSE_RANGE[0]}–{DOSE_RANGE[1]}g/m³，仓压 ≥{MIN_PRESSURE}Pa）。
      </p>
    </div>
  );
}

function AddComponentCard({
  onClose,
  onSubmit,
}: {
  onClose: () => void;
  onSubmit: (draft: {
    building: string;
    code: string;
    wood: string;
    joint: string;
    section: string;
    disease: string;
    advice: string;
  }) => void;
}) {
  const [f, setF] = useState({
    building: "清一堂",
    code: "",
    wood: "楠木",
    joint: "透榫",
    section: "",
    disease: "",
    advice: "",
  });
  const valid = f.code.trim() && f.section.trim() && f.building.trim();
  return (
    <div className="card detail-card">
      <div className="heading">
        <h3>新增测绘构件</h3>
        <button onClick={onClose}>关闭</button>
      </div>
      <div className="field-grid">
        <label>
          <span>建筑名称</span>
          <input value={f.building} onChange={(e) => setF({ ...f, building: e.target.value })} />
        </label>
        <label>
          <span>构件编号</span>
          <input value={f.code} onChange={(e) => setF({ ...f, code: e.target.value })} placeholder="如 梁架A-09" />
        </label>
        <label>
          <span>木材种类</span>
          <input value={f.wood} onChange={(e) => setF({ ...f, wood: e.target.value })} />
        </label>
        <label>
          <span>榫卯类型</span>
          <select value={f.joint} onChange={(e) => setF({ ...f, joint: e.target.value })}>
            {JOINTS.map((j) => (
              <option key={j}>{j}</option>
            ))}
          </select>
        </label>
        <label>
          <span>截面尺寸</span>
          <input value={f.section} onChange={(e) => setF({ ...f, section: e.target.value })} placeholder="如 180×240mm" />
        </label>
        <label>
          <span>病害位置 / 蛀屑情况</span>
          <input value={f.disease} onChange={(e) => setF({ ...f, disease: e.target.value })} />
        </label>
        <label className="span-2">
          <span>修缮建议</span>
          <input value={f.advice} onChange={(e) => setF({ ...f, advice: e.target.value })} />
        </label>
      </div>
      <div className="actions">
        <button className="primary" disabled={!valid} onClick={() => valid && onSubmit(f)}>
          保存测绘
        </button>
      </div>
    </div>
  );
}

function EditComponentCard({
  component,
  now,
  onClose,
  onSave,
  onOpenBatch,
}: {
  component: Component;
  now: number;
  onClose: () => void;
  onSave: (patch: {
    section?: string;
    disease?: string;
    replaced?: boolean;
    advice?: string;
    wood?: string;
  }) => void;
  onOpenBatch: (id: string) => void;
}) {
  const { state, componentBatch } = useStation();
  const batch = componentBatch(component.id);
  const [section, setSection] = useState(component.section);
  const [disease, setDisease] = useState(component.disease);
  const [replaced, setReplaced] = useState(component.replaced);
  const [advice, setAdvice] = useState(component.advice);
  const [wood, setWood] = useState(component.wood);

  const willInvalidate =
    batch &&
    (batch.status === "fumigating" || batch.status === "released") &&
    (section !== component.section || disease !== component.disease || replaced !== component.replaced);

  const related = state.batches
    .filter((b) => b.componentIds.includes(component.id))
    .sort((a, b) => b.seq - a.seq);

  return (
    <div className="card detail-card" id={`edit-${component.id}`}>
      <div className="heading">
        <h3>
          测绘记录 · {component.code}{" "}
          <small className="muted">
            {component.building} · {component.joint} · rev.{component.revision}
          </small>
        </h3>
        <button onClick={onClose}>关闭</button>
      </div>

      <div className="field-grid">
        <label>
          <span>木材种类（非关键）</span>
          <input value={wood} onChange={(e) => setWood(e.target.value)} />
        </label>
        <label>
          <span>截面尺寸（关键）</span>
          <input
            value={section}
            onChange={(e) => setSection(e.target.value)}
            className={section !== component.section ? "input-dirty" : ""}
          />
        </label>
        <label className="span-2">
          <span>病害位置 / 蛀屑（关键）</span>
          <input
            value={disease}
            onChange={(e) => setDisease(e.target.value)}
            className={disease !== component.disease ? "input-dirty" : ""}
          />
        </label>
        <label className="check-line critical">
          <span>换件（关键）</span>
          <label className="inline-check">
            <input
              type="checkbox"
              checked={replaced}
              onChange={(e) => setReplaced(e.target.checked)}
            />
            该构件已换件（旧件下架）
          </label>
        </label>
        <label className="span-2">
          <span>修缮建议（非关键）</span>
          <input value={advice} onChange={(e) => setAdvice(e.target.value)} />
        </label>
      </div>

      {willInvalidate && (
        <div className="alert warn">
          ⚠ 该构件关联批次 <b>{batch!.id}</b>（{PHASE_LABEL_BATCH(batch!.status)}）。
          保存关键变更将使原{batch!.status === "released" ? "放行失效" : "处理中断"}
          ，批次作废重算、旧批只读，须重新熏蒸。
        </div>
      )}

      <div className="batch-history">
        <span>批次沿革：</span>
        {related.length === 0 && <span className="muted">无熏蒸批次</span>}
        {related.map((b) => (
          <button
            key={b.id}
            className={"mini-batch " + (isReadOnly(b) ? "sealed" : "active-b")}
            onClick={() => onOpenBatch(b.id)}
            title={b.rejectReason ?? b.invalidateReason ?? formatDateTime(b.startedAt)}
          >
            {b.id} · {BATCH_STATUS_LABEL[b.status]}
            {isReadOnly(b) ? " 🔒" : ""}
          </button>
        ))}
      </div>

      <div className="actions">
        <button
          className="primary"
          onClick={() =>
            onSave({
              ...(wood !== component.wood ? { wood } : {}),
              ...(section !== component.section ? { section } : {}),
              ...(disease !== component.disease ? { disease } : {}),
              ...(replaced !== component.replaced ? { replaced } : {}),
              ...(advice !== component.advice ? { advice } : {}),
            })
          }
        >
          保存修改{willInvalidate ? "并作废重算" : ""}
        </button>
        <span className="muted">当前账载时间 {formatDateTime(now)}</span>
      </div>
    </div>
  );
}

const BATCH_STATUS_LABEL: Record<string, string> = {
  rejected: "整批拒绝",
  fumigating: "熏蒸中",
  released: "已放行",
  invalidated: "已作废",
};

function PHASE_LABEL_BATCH(status: string): string {
  return BATCH_STATUS_LABEL[status] ?? status;
}
