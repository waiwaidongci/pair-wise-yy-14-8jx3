// 施药登记视图：登记药剂批次/浓度/仓压/施药人，选择仓罩与构件
// 关键规则：同罩处理中仅接一批（重复沿用首批）；药剂过期或仓压不足整批拒绝。

import { useMemo, useState } from "react";
import {
  DOSE_RANGE,
  MIN_PRESSURE,
  isExpired,
  isPressureSufficient,
  toLocalInputValue,
} from "../fumigation/rules";
import { useStation } from "../fumigation/station";

export function RegisterView() {
  const {
    state,
    now,
    registerBatch,
    gotoBatch,
    busyComponents,
    occupiedTents,
    setView,
  } = useStation();

  const freeTents = state.tents.filter((t) => !occupiedTents.has(t.id));
  const [tentId, setTentId] = useState(freeTents[0]?.id ?? state.tents[0]?.id ?? "");
  const [chemicalCode, setChemicalCode] = useState(state.chemicals[0]?.code ?? "");
  const [dose, setDose] = useState<number>(32);
  const [pressure, setPressure] = useState<number>(300);
  const [applicator, setApplicator] = useState(state.operators[0] ?? "");
  const [startedAt, setStartedAt] = useState(toLocalInputValue(now));
  const [picked, setPicked] = useState<string[]>([]);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [customChemical, setCustomChemical] = useState(false);
  const [customExpiry, setCustomExpiry] = useState("");

  const chemical = state.chemicals.find((c) => c.code === chemicalCode);
  const expiry = customChemical ? customExpiry : chemical?.expiry ?? "";

  const tentBusy = occupiedTents.has(tentId);
  const expired = expiry ? isExpired(expiry, now) : false;
  const pressureLow = !isPressureSufficient(pressure);

  const selectableComponents = useMemo(
    () => state.components.filter((c) => !busyComponents.has(c.id)),
    [state.components, busyComponents],
  );
  const busyList = state.components.filter((c) => busyComponents.has(c.id));

  const togglePick = (id: string) => {
    setPicked((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const runPreview = (): string | null => {
    if (tentBusy) return null; // 沿用路径不在此拦截
    const errs: string[] = [];
    if (picked.length === 0) errs.push("未勾选构件");
    if (!customChemical && !chemical) errs.push("未选择药剂批次");
    if (customChemical && !chemicalCode.trim()) errs.push("药剂批次号未填");
    if (!expiry) errs.push("有效期未填");
    if (expired) errs.push(`药剂已过有效期（${expiry}）`);
    if (pressureLow) errs.push(`仓压 ${pressure}Pa 低于 ${MIN_PRESSURE}Pa`);
    if (!applicator.trim()) errs.push("施药人未签名");
    if (!Number.isFinite(dose) || dose <= 0) errs.push("施药浓度无效");
    if (!startedAt) errs.push("施药时间未填");
    return errs.length ? errs.join("；") + "，整批拒绝。" : null;
  };

  const handleSubmit = () => {
    const error = runPreview();
    if (error) setPreviewError(error);
    const outcome = registerBatch({
      tentId,
      componentIds: picked,
      chemical: chemicalCode,
      expiry,
      dose,
      pressure,
      applicator,
      startedAt: new Date(startedAt).getTime(),
    });
    if (outcome.kind === "created" && outcome.batchId) {
      setPicked([]);
      gotoBatch(outcome.batchId, "queue");
    } else if (outcome.kind === "reused" && outcome.batchId) {
      gotoBatch(outcome.batchId, "queue");
    }
  };

  return (
    <div className="view register-view">
      <div className="two-col">
        <div className="card">
          <div className="heading">
            <h3>① 仓罩与构件</h3>
          </div>

          <label className="field">
            <span>熏蒸仓罩（同一仓罩处理中仅接一批）</span>
            <select value={tentId} onChange={(e) => setTentId(e.target.value)}>
              {state.tents.map((t) => {
                const busy = occupiedTents.has(t.id);
                return (
                  <option key={t.id} value={t.id} disabled={busy}>
                    {t.id} · {t.name}
                    {busy ? "（处理中·沿用首批）" : "（空闲）"}
                  </option>
                );
              })}
            </select>
          </label>

          {tentBusy && (
            <div className="alert warn">
              该仓罩正在处理一批熏蒸，重复登记将<b>沿用首批</b>，不会另开批次、不重复施药。
              如需另接，请待当前批次复位放行（仓罩自动释放）后再登记。
            </div>
          )}

          <div className="pick-list">
            <div className="pick-head">
              <span>选择入罩构件（{picked.length}）</span>
              <small>处理中的构件不可重复选入</small>
            </div>
            {selectableComponents.map((c) => (
              <label key={c.id} className="pick-item">
                <input
                  type="checkbox"
                  checked={picked.includes(c.id)}
                  onChange={() => togglePick(c.id)}
                  disabled={tentBusy}
                />
                <span>
                  <b>{c.code}</b> · {c.building} · {c.wood} · {c.joint}
                  <small>{c.id} · {c.disease}</small>
                </span>
              </label>
            ))}
            {busyList.length > 0 && (
              <div className="pick-busy">
                处理中不可选：
                {busyList.map((c) => (
                  <span key={c.id} className="busy-chip">{c.code}</span>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="card">
          <div className="heading">
            <h3>② 施药登记</h3>
          </div>

          <label className="field">
            <span>药剂批次</span>
            <select
              value={customChemical ? "__custom__" : chemicalCode}
              onChange={(e) => {
                if (e.target.value === "__custom__") {
                  setCustomChemical(true);
                  setChemicalCode("");
                } else {
                  setCustomChemical(false);
                  setChemicalCode(e.target.value);
                }
              }}
            >
              {state.chemicals.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.name} · {c.code}（有效期 {c.expiry}）
                </option>
              ))}
              <option value="__custom__">手工录入其它批次…</option>
            </select>
          </label>

          {customChemical && (
            <div className="field-grid">
              <label className="field">
                <span>药剂批次号</span>
                <input
                  value={chemicalCode}
                  onChange={(e) => setChemicalCode(e.target.value)}
                  placeholder="如 SF-2026-201"
                />
              </label>
              <label className="field">
                <span>有效期</span>
                <input type="date" value={customExpiry} onChange={(e) => setCustomExpiry(e.target.value)} />
              </label>
            </div>
          )}

          <div className="field-grid">
            <label className="field">
              <span>施药浓度 g/m³（建议 {DOSE_RANGE[0]}–{DOSE_RANGE[1]}）</span>
              <input
                type="number"
                value={dose}
                min={0}
                onChange={(e) => setDose(Number(e.target.value))}
              />
            </label>
            <label className="field">
              <span>
                仓压 Pa（≥{MIN_PRESSURE}）
                {pressureLow && <em className="inline-err"> 仓压不足</em>}
              </span>
              <input
                type="number"
                value={pressure}
                className={pressureLow ? "input-err" : ""}
                onChange={(e) => setPressure(Number(e.target.value))}
              />
            </label>
            <label className="field">
              <span>施药人</span>
              <select value={applicator} onChange={(e) => setApplicator(e.target.value)}>
                <option value="">请签名…</option>
                {state.operators.map((o) => (
                  <option key={o}>{o}</option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>施药时间</span>
              <input
                type="datetime-local"
                value={startedAt}
                onChange={(e) => setStartedAt(e.target.value)}
              />
            </label>
          </div>

          <div className="preflight">
            <p className="pre-title">提交前判定：</p>
            <Preflight
              tentBusy={tentBusy}
              pickedCount={picked.length}
              expired={expired}
              expiry={expiry}
              pressureLow={pressureLow}
              pressure={pressure}
              applicator={applicator}
              onQueue={() => setView("queue")}
            />
          </div>

          {previewError && <div className="alert error">✕ {previewError}</div>}

          <div className="actions">
            <button className="primary" onClick={handleSubmit}>
              {tentBusy ? "沿用首批登记（跳转隔离队列）" : "登记施药·整批入罩"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function Preflight({
  tentBusy,
  pickedCount,
  expired,
  expiry,
  pressureLow,
  pressure,
  applicator,
  onQueue,
}: {
  tentBusy: boolean;
  pickedCount: number;
  expired: boolean;
  expiry: string;
  pressureLow: boolean;
  pressure: number;
  applicator: string;
  onQueue: () => void;
}) {
  if (tentBusy) {
    return (
      <ul className="checks">
        <li className="ch-warn">仓罩处理中 —— 重复登记沿用首批，不新开批次</li>
        <li className="ch-ok">可{" "}
          <button className="link" onClick={onQueue}>前往隔离队列</button>
          {" "}查看首批复检进度
        </li>
      </ul>
    );
  }
  return (
    <ul className="checks">
      <li className={pickedCount > 0 ? "ch-ok" : "ch-bad"}>
        已选构件 {pickedCount} 个{pickedCount === 0 && "（至少 1 个）"}
      </li>
      <li className={expired ? "ch-bad" : "ch-ok"}>
        药剂有效期 {expiry || "未填"}：{expired ? "已过期，整批拒绝" : "有效"}
      </li>
      <li className={pressureLow ? "ch-bad" : "ch-ok"}>
        仓压 {pressure}Pa：{pressureLow ? `不足 ${MIN_PRESSURE}Pa，整批拒绝` : "达标"}
      </li>
      <li className={applicator ? "ch-ok" : "ch-bad"}>
        施药人：{applicator || "未签名"}
      </li>
    </ul>
  );
}
