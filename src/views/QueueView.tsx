// 隔离队列视图：熏蒸密闭 → 非施药人隔 24h 两次复检 → 蛀屑无新增且浓度回落 → 复位放行

import { useEffect, useMemo, useState } from "react";
import {
  FumigationBatch,
  MIN_PRESSURE,
  RECHECK_GAP,
  REQUIRED_RECHECKS,
  SAFE_RESIDUAL_PPM,
  formatDateTime,
  nextRecheckEarliest,
  toLocalInputValue,
} from "../fumigation/rules";
import { useStation } from "../fumigation/station";

export function QueueView() {
  const {
    queueRows,
    state,
    now,
    focusBatchId,
    addRecheck,
    release,
    gotoComponent,
  } = useStation();
  const rows = queueRows();
  const [openId, setOpenId] = useState<string | null>(focusBatchId);

  useEffect(() => {
    if (focusBatchId) setOpenId(focusBatchId);
  }, [focusBatchId]);

  const componentOf = (id: string) => state.components.find((c) => c.id === id);

  return (
    <div className="view">
      <div className="queue-strip">
        {rows.length === 0 && (
          <div className="empty-hint">
            当前隔离队列为空：没有熏蒸中的批次。前往「施药登记」开一批。
          </div>
        )}
        {rows.map((row) => {
          const b = row.batch;
          const open = openId === b.id;
          const round = b.rechecks.length;
          return (
            <article
              key={b.id}
              id={`batch-${b.id}`}
              className={"card queue-card" + (open ? " open" : "")}
            >
              <header className="queue-head" onClick={() => setOpenId(open ? null : b.id)}>
                <div className="qh-main">
                  <h3>{b.id}</h3>
                  <small>
                    {b.tentId} 仓罩 · 施药 {formatDateTime(b.startedAt)} · 施药人 {b.applicator}
                  </small>
                  <div className="queue-components">
                    {b.componentIds.map((id) => {
                      const c = componentOf(id);
                      return (
                        <span key={id} className="cq-chip">
                          {c?.code ?? id}
                        </span>
                      );
                    })}
                  </div>
                </div>
                <div className="qh-side">
                  <span className={"phase " + (round === 0 ? "ph-fum" : "ph-wait")}>
                    {round === 0
                      ? "熏蒸密闭中"
                      : round === 1
                        ? "待第二次复检"
                        : "复检完成"}
                  </span>
                  <span className="countdown">
                    {round < REQUIRED_RECHECKS ? row.countdown : "可复位"}
                  </span>
                  <span className="chev">{open ? "▾" : "▸"}</span>
                </div>
              </header>

              {open && (
                <RecheckPanel
                  batch={b}
                  now={now}
                  onRecheck={(input) => addRecheck(b.id, input)}
                  onRelease={() => release(b.id)}
                  onOpenComponent={(id) => gotoComponent(id, "list")}
                />
              )}
            </article>
          );
        })}
      </div>

      <p className="rule-note">
        复检铁律：须由<span className="k">非施药人</span>执行，两次复检间隔不少于
        <span className="k">二十四小时</span>（首次复检距施药同样满 24h）；
        两次均满足<span className="k">蛀屑无新增</span>且残留浓度回落至 ≤{SAFE_RESIDUAL_PPM}ppm
        方可复位放行。发现新增蛀屑或末次浓度未回落，批次作废重熏。
      </p>
    </div>
  );
}

function RecheckPanel({
  batch,
  now,
  onRecheck,
  onRelease,
  onOpenComponent,
}: {
  batch: FumigationBatch;
  now: number;
  onRecheck: (input: { inspector: string; at: number; residualPpm: number; newFrass: boolean }) => boolean;
  onRelease: () => void;
  onOpenComponent: (id: string) => void;
}) {
  const { state } = useStation();

  const round = batch.rechecks.length;
  const earliest = nextRecheckEarliest(batch)!;
  const canRecheckNow = now >= earliest && round < REQUIRED_RECHECKS;
  const eligibleInspectors = state.operators.filter((o) => o !== batch.applicator);

  const [inspector, setInspector] = useState(eligibleInspectors[0] ?? "");
  const [at, setAt] = useState(toLocalInputValue(Math.max(now, earliest)));
  const [residual, setResidual] = useState<number>(4);
  const [newFrass, setNewFrass] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const atTs = new Date(at).getTime();
  const inspectorBad = inspector.trim() === batch.applicator.trim();
  const tooEarly = atTs < earliest;
  const inspectorEmpty = inspector.trim() === "";

  const submitReady = canRecheckNow && !inspectorBad && !tooEarly && !inspectorEmpty;

  const twoPassed =
    batch.rechecks.length >= REQUIRED_RECHECKS &&
    batch.rechecks
      .slice(0, REQUIRED_RECHECKS)
      .every((r) => !r.newFrass && r.residualPpm <= SAFE_RESIDUAL_PPM);

  const atHint = useMemo(() => {
    const ms = earliest - atTs;
    if (ms <= 0) return "时间间隔满足二十四小时";
    const h = Math.floor(ms / 3600000);
    const m = Math.floor((ms % 3600000) / 60000);
    return `距可复检时间还差 ${h}小时${String(m).padStart(2, "0")}分`;
  }, [earliest, atTs]);

  const componentOf = (id: string) => state.components.find((c) => c.id === id);

  return (
    <div className="recheck-panel">
      <div className="recheck-meta">
        <div>
          <small>药剂 / 浓度</small>
          <b>{batch.chemical}</b> · {batch.dose}g/m³
        </div>
        <div>
          <small>登记仓压</small>
          <b className={batch.pressure >= MIN_PRESSURE ? "ok-text" : "bad-text"}>
            {batch.pressure}Pa
          </b>
        </div>
        <div>
          <small>复检人池（排除施药人 {batch.applicator}）</small>
          <b>{eligibleInspectors.join("、") || "无可选复检人"}</b>
        </div>
      </div>

      <ol className="recheck-timeline">
        <li className="done">
          <span className="tl-time">{formatDateTime(batch.startedAt)}</span>
          <span className="tl-dot" />
          <div>
            <b>施药密闭</b>
            <small>{batch.applicator} 施药，仓压 {batch.pressure}Pa</small>
          </div>
        </li>
        {batch.rechecks.map((r, i) => (
          <li key={i} className={r.newFrass || r.residualPpm > SAFE_RESIDUAL_PPM ? "fail" : "done"}>
            <span className="tl-time">{formatDateTime(r.at)}</span>
            <span className="tl-dot" />
            <div>
              <b>
                第 {i + 1} 次复检 · {r.inspector}
                {r.inspector === batch.applicator && <em className="inline-err">（与施药人同人，违规）</em>}
              </b>
              <small>
                残留 {r.residualPpm}ppm（阈值 ≤{SAFE_RESIDUAL_PPM}）·
                蛀屑{r.newFrass ? "有新增 ✕" : "无新增 ✓"}
              </small>
            </div>
          </li>
        ))}
        {round < REQUIRED_RECHECKS && (
          <li className="pending">
            <span className="tl-time">最早 {formatDateTime(earliest)}</span>
            <span className="tl-dot" />
            <div>
              <b>第 {round + 1} 次复检</b>
              <small>与{round === 0 ? "施药" : "上次复检"}节点间隔须 ≥ 24h（{RECHECK_GAP / 3600000} 小时）</small>
            </div>
          </li>
        )}
      </ol>

      {round < REQUIRED_RECHECKS ? (
        <div className="recheck-form">
          <div className="field-grid">
            <label className="field">
              <span>复检人（不可为施药人 {batch.applicator}）</span>
              <select value={inspector} onChange={(e) => setInspector(e.target.value)}>
                <option value="">请选择…</option>
                {state.operators.map((o) => (
                  <option key={o} disabled={o === batch.applicator}>
                    {o}
                    {o === batch.applicator ? "（施药人，禁止复检）" : ""}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>复检时间 · {atHint}</span>
              <input
                type="datetime-local"
                value={at}
                className={tooEarly ? "input-err" : ""}
                onChange={(e) => setAt(e.target.value)}
              />
            </label>
            <label className="field">
              <span>残留浓度 ppm（≤{SAFE_RESIDUAL_PPM} 视为回落）</span>
              <input
                type="number"
                value={residual}
                min={0}
                onChange={(e) => setResidual(Number(e.target.value))}
              />
            </label>
            <label className="field check-line">
              <span>蛀屑情况</span>
              <label className="inline-check">
                <input
                  type="checkbox"
                  checked={newFrass}
                  onChange={(e) => setNewFrass(e.target.checked)}
                />
                发现新增蛀屑（蚁患未除）
              </label>
            </label>
          </div>

          {!canRecheckNow && (
            <div className="alert warn">尚未到二十四小时复检节点，无法提交复检。</div>
          )}
          {inspectorBad && <div className="alert error">复检人与施药人同为 {batch.applicator}，须换人。</div>}
          {tooEarly && <div className="alert error">{atHint}，时间不足不能复检。</div>}
          {error && <div className="alert error">{error}</div>}

          <div className="actions">
            <button
              className="primary"
              disabled={!submitReady}
              onClick={() => {
                const ok = onRecheck({ inspector, at: atTs, residualPpm: residual, newFrass });
                if (ok) {
                  setError(null);
                  setNewFrass(false);
                  setResidual(4);
                  setAt(toLocalInputValue(Math.max(Date.now(), earliest + RECHECK_GAP)));
                } else {
                  setError("复检未被接受，请检查签名、间隔与测量值。");
                }
              }}
            >
              提交第 {round + 1} 次复检
            </button>
          </div>
        </div>
      ) : (
        <div className="release-box">
          {twoPassed ? (
            <>
              <div className="alert ok">
                ✓ 两次复检均合格：蛀屑无新增、浓度回落至 {SAFE_RESIDUAL_PPM}ppm 以下，可复位放行。
              </div>
              <div className="actions">
                <button className="primary big" onClick={onRelease}>
                  构件复位 · 签批放行
                </button>
              </div>
            </>
          ) : (
            <div className="alert error">
              ✕ 复检未全部合格，本批应作废并重新熏蒸（队列已自动移出该批，可在批次台账查看）。
            </div>
          )}
        </div>
      )}

      <div className="recheck-components">
        <small>入罩构件（放行前不得复位、不得改动尺寸/病害/换件）：</small>
        <div>
          {batch.componentIds.map((id) => {
            const c = componentOf(id);
            return (
              <button key={id} className="link" onClick={() => onOpenComponent(id)}>
                {c?.code ?? id}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
