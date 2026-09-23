import "./styles.css";
import { StationProvider, useStation, type ViewKey } from "./fumigation/station";
import { ComponentList } from "./views/ComponentList";
import { RegisterView } from "./views/RegisterView";
import { QueueView } from "./views/QueueView";
import { LedgerView } from "./views/LedgerView";
import { GraphView } from "./views/GraphView";

const NAV: { key: ViewKey; label: string; desc: string }[] = [
  { key: "list", label: "构件清单", desc: "测绘字段 / 病害" },
  { key: "register", label: "施药登记", desc: "药剂·仓压·入罩" },
  { key: "queue", label: "隔离队列", desc: "24h×2 复检放行" },
  { key: "ledger", label: "批次台账", desc: "留痕·旧批只读" },
  { key: "graph", label: "关系图", desc: "建筑-构件-仓罩" },
];

function Shell() {
  const {
    view,
    setView,
    state,
    now,
    toasts,
    dismissToast,
    resetDemo,
    queueRows,
    componentPhase,
  } = useStation();

  const queue = queueRows();
  const occupied = queue.length;
  const rejected = state.batches.filter((b) => b.status === "rejected").length;
  const released = state.batches.filter((b) => b.status === "released").length;
  const invalidated = state.batches.filter((b) => b.status === "invalidated").length;
  const activeComponents = state.components.filter(
    (c) => componentPhase(c.id) === "fumigating" ||
      componentPhase(c.id) === "await-recheck" ||
      componentPhase(c.id) === "await-second",
  ).length;

  const metrics = [
    { label: "在册构件", value: state.components.length },
    { label: "隔离熏蒸中", value: activeComponents },
    { label: "占用仓罩", value: `${occupied}/${state.tents.length}` },
    { label: "已放行", value: released },
    { label: "整批拒绝", value: rejected },
    { label: "失效重算", value: invalidated },
  ];

  const clock = new Date(now);
  const pad = (n: number) => String(n).padStart(2, "0");

  return (
    <main className="app">
      <section className="hero station-hero">
        <p>古建筑木结构 · 白蚁熏蒸隔离与复位放行台</p>
        <h1>榫卯构件白蚁熏蒸台</h1>
        <span>
          同一仓罩处理中仅接一批，重复登记沿用首批；登记药剂批次、浓度、仓压与施药人，
          药剂过期或仓压不足整批拒绝。熏蒸后由非施药人隔 24 小时复检两次，蛀屑无新增且浓度回落方可复位；
          处理期间改动截面尺寸、病害或换件，原放行失效重算，旧批只读封存。
        </span>
        <div className="hero-clock">
          台账时钟 {clock.getFullYear()}-{pad(clock.getMonth() + 1)}-{pad(clock.getDate())}{" "}
          {pad(clock.getHours())}:{pad(clock.getMinutes())}
          <button onClick={resetDemo} className="ghost">重置为演示台账</button>
        </div>
      </section>

      <section className="metrics metrics-6">
        {metrics.map((m) => (
          <article key={m.label}>
            <small>{m.label}</small>
            <strong>{m.value}</strong>
          </article>
        ))}
      </section>

      <nav className="main-nav">
        {NAV.map((n) => (
          <button
            key={n.key}
            className={"nav-item" + (view === n.key ? " nav-on" : "")}
            onClick={() => setView(n.key)}
          >
            <b>{n.label}</b>
            <small>{n.desc}</small>
          </button>
        ))}
      </nav>

      <section className="stage">
        {view === "list" && <ComponentList />}
        {view === "register" && <RegisterView />}
        {view === "queue" && <QueueView />}
        {view === "ledger" && <LedgerView />}
        {view === "graph" && <GraphView />}
      </section>

      <footer className="foot">
        判定规则、批次账、界面状态分置 <code>src/fumigation/rules.ts</code>、
        <code>ledger.ts</code>、<code>station.tsx</code>；数据持久化于浏览器本地，刷新后清单 / 隔离队列 / 关系图一致。
      </footer>

      <div className="toast-stack">
        {toasts.map((t) => (
          <div key={t.id} className={"toast toast-" + t.level} onClick={() => dismissToast(t.id)}>
            {t.text}
          </div>
        ))}
      </div>
    </main>
  );
}

function App() {
  return (
    <StationProvider>
      <Shell />
    </StationProvider>
  );
}

export default App;
