// 批次台账视图：全部批次留痕（含整批拒绝），旧批只读封存，放行快照与现况对比

import { useState } from "react";
import {
  BatchStatus,
  FumigationBatch,
  SAFE_RESIDUAL_PPM,
  formatDateTime,
  isReadOnly,
} from "../fumigation/rules";
import { snapshotsMatch } from "../fumigation/ledger";
import { useStation } from "../fumigation/station";

const STATUS_LABEL: Record<BatchStatus, string> = {
  rejected: "整批拒绝",
  fumigating: "熏蒸中",
  released: "已放行",
  invalidated: "已作废",
};

const STATUS_CLASS: Record<BatchStatus, string> = {
  rejected: "ph-bad",
  fumigating: "ph-fum",
  released: "ph-ok",
  invalidated: "ph-bad",
};

export function LedgerView() {
  const { state, tentName, focusBatchId, gotoBatch } = useStation();
  const [filter, setFilter] = useState<BatchStatus | "all">("all");
  const [openId, setOpenId] = useState<string | null>(focusBatchId);

  const batches = [...state.batches]
    .sort((a, b) => b.seq - a.seq)
    .filter((b) => filter === "all" || b.status === filter);

  const counts = state.batches.reduce(
    (acc, b) => {
      acc[b.status] += 1;
      return acc;
    },
    { rejected: 0, fumigating: 0, released: 0, invalidated: 0 } as Record<BatchStatus, number>,
  );

  const tabs: { key: BatchStatus | "all"; label: string; n: number }[] = [
    { key: "all", label: "全部", n: state.batches.length },
    { key: "fumigating", label: "熏蒸中", n: counts.fumigating },
    { key: "released", label: "已放行", n: counts.released },
    { key: "rejected", label: "整批拒绝", n: counts.rejected },
    { key: "invalidated", label: "已作废", n: counts.invalidated },
  ];

  return (
    <div className="view">
      <div className="tabs">
        {tabs.map((t) => (
          <button
            key={t.key}
            className={"tab" + (filter === t.key ? " tab-on" : "")}
            onClick={() => setFilter(t.key)}
          >
            {t.label}
            <span className="tab-n">{t.n}</span>
          </button>
        ))}
      </div>

      <div className="ledger-list">
        {batches.map((b) => (
          <BatchCard
            key={b.id}
            batch={b}
            open={openId === b.id}
            tentLabel={tentName(b.tentId)}
            onToggle={() => {
              setOpenId(openId === b.id ? null : b.id);
              gotoBatch(b.id, "ledger");
            }}
          />
        ))}
        {batches.length === 0 && <div className="empty-hint">该状态下暂无批次记录。</div>}
      </div>
    </div>
  );
}

function BatchCard({
  batch,
  open,
  tentLabel,
  onToggle,
}: {
  batch: FumigationBatch;
  open: boolean;
  tentLabel: string;
  onToggle: () => void;
}) {
  const { state } = useStation();
  const sealed = isReadOnly(batch);
  const match = snapshotsMatch(batch, state.components);
  const componentOf = (id: string) => state.components.find((c) => c.id === id);

  return (
    <article className={"card ledger-card status-" + batch.status + (open ? " open" : "")}>
      <header className="ledger-head" onClick={onToggle}>
        <div className="lh-id">
          <h3>
            {batch.id}
            {sealed && <span className="seal" title="旧批只读封存">🔒 只读</span>}
          </h3>
          <small>
            {batch.tentId} · {tentLabel} · 施药 {formatDateTime(batch.startedAt)}
          </small>
        </div>
        <div className="lh-right">
          <span className={"phase " + STATUS_CLASS[batch.status]}>
            {STATUS_LABEL[batch.status]}
          </span>
          <span className="chev">{open ? "▾" : "▸"}</span>
        </div>
      </header>

      {open && (
        <div className="ledger-body">
          <section className="lb-grid">
            <Field label="药剂批次" value={batch.chemical} />
            <Field label="有效期" value={batch.expiry} />
            <Field label="施药浓度" value={`${batch.dose} g/m³`} />
            <Field label="仓压" value={`${batch.pressure} Pa`} />
            <Field label="施药人" value={batch.applicator} />
            <Field
              label="放行时间"
              value={batch.releasedAt ? formatDateTime(batch.releasedAt) : "—"}
            />
          </section>

          <section className="lb-components">
            <h4>入罩构件</h4>
            <div className="ledger-components">
              {batch.componentIds.map((id) => {
                const c = componentOf(id);
                return (
                  <div key={id} className="lc-item">
                    <b>{c?.code ?? id}</b>
                    <small>{c ? `${c.building} · ${c.wood} · ${c.joint}` : "构件已删除"}</small>
                  </div>
                );
              })}
            </div>
          </section>

          {batch.status === "rejected" && (
            <div className="alert error">
              <b>整批拒绝留痕：</b>
              {batch.rejectReason}
              <br />
              <small>该批未占用仓罩，整改药剂/仓压后可重新登记。</small>
            </div>
          )}

          {batch.status === "invalidated" && (
            <div className="alert warn">
              <b>作废重算：</b>
              {batch.invalidateReason}
            </div>
          )}

          {batch.rechecks.length > 0 && (
            <section className="lb-rechecks">
              <h4>复检记录（非施药人 · 间隔 24h · 共 {batch.rechecks.length} 次）</h4>
              <table className="inner-table">
                <thead>
                  <tr>
                    <th>序次</th>
                    <th>时间</th>
                    <th>复检人</th>
                    <th>残留 ppm</th>
                    <th>蛀屑</th>
                    <th>判定</th>
                  </tr>
                </thead>
                <tbody>
                  {batch.rechecks.map((r, i) => {
                    const pass = !r.newFrass && r.residualPpm <= SAFE_RESIDUAL_PPM;
                    return (
                      <tr key={i}>
                        <td>第 {i + 1} 次</td>
                        <td>{formatDateTime(r.at)}</td>
                        <td>
                          {r.inspector}
                          {r.inspector === batch.applicator && (
                            <em className="inline-err"> 同人违规</em>
                          )}
                        </td>
                        <td className={pass ? "ok-text" : "bad-text"}>{r.residualPpm}</td>
                        <td>{r.newFrass ? "新增 ✕" : "无新增 ✓"}</td>
                        <td>{pass ? "合格" : "不合格"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </section>
          )}

          {batch.releasedSnapshots && (
            <section className="lb-snapshots">
              <h4>
                放行快照核对
                <span className={match ? "snap-ok" : "snap-bad"}>
                  {match ? "与现况一致" : "与现况不符（已触发失效重算）"}
                </span>
              </h4>
              <table className="inner-table">
                <thead>
                  <tr>
                    <th>构件</th>
                    <th>放行时截面</th>
                    <th>当前截面</th>
                    <th>放行时病害</th>
                    <th>当前病害</th>
                    <th>放行时换件</th>
                    <th>当前换件</th>
                  </tr>
                </thead>
                <tbody>
                  {batch.componentIds.map((id) => {
                    const c = componentOf(id);
                    const s = batch.releasedSnapshots![id];
                    const diff = (a: string, b: string) => a !== b;
                    return (
                      <tr key={id}>
                        <td>{c?.code ?? id}</td>
                        <td className={diff(s?.section ?? "", c?.section ?? "") ? "cell-diff" : ""}>
                          {s?.section ?? "—"}
                        </td>
                        <td className={diff(s?.section ?? "", c?.section ?? "") ? "cell-diff" : ""}>
                          {c?.section ?? "—"}
                        </td>
                        <td className={diff(s?.disease ?? "", c?.disease ?? "") ? "cell-diff" : ""}>
                          {s?.disease ?? "—"}
                        </td>
                        <td className={diff(s?.disease ?? "", c?.disease ?? "") ? "cell-diff" : ""}>
                          {c?.disease ?? "—"}
                        </td>
                        <td className={s?.replaced !== c?.replaced ? "cell-diff" : ""}>
                          {s?.replaced ? "是" : "否"}
                        </td>
                        <td className={s?.replaced !== c?.replaced ? "cell-diff" : ""}>
                          {c?.replaced ? "是" : "否"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </section>
          )}

          {sealed && (
            <p className="sealed-note">
              本批为历史批次（拒绝 / 作废 / 已放行），全部字段只读，不可补录或修改；
              需要重新处理时请对构件另开新批。
            </p>
          )}
        </div>
      )}
    </article>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="field-box">
      <small>{label}</small>
      <b>{value}</b>
    </div>
  );
}
