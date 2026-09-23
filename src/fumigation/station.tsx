// 白蚁熏蒸放行台 —— 界面状态层
// 职责：全局 Context（台账数据 + 当前时间）、操作动作（登记/复检/放行/构件变更）、
//      页面焦点与提示消息、派生选择器。清单 / 隔离队列 / 关系图均从同一份 state 派生，
//      且通过 localStorage 持久化，页面刷新后三处视图保持一致。

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  Component,
  ComponentPhase,
  FumigationBatch,
  PHASE_LABEL,
  RegisterInput,
  RegisterOutcome,
  RecheckInput,
  Tent,
  busyComponentIds,
  canRelease,
  formatCountdown,
  nextRecheckEarliest,
  occupiedTentIds,
  phaseOf,
} from "./rules";
import {
  ChemicalStock,
  ComponentPatch,
  NewComponentDraft,
  StationState,
  applyRecheck,
  applyRegister,
  applyRelease,
  addComponent,
  clearPersistedState,
  createSeedState,
  loadState,
  saveState,
  updateComponent,
} from "./ledger";

export type ViewKey = "list" | "register" | "queue" | "ledger" | "graph";

export interface Toast {
  id: number;
  level: "ok" | "warn" | "error";
  text: string;
}

export interface QueueRow {
  batch: FumigationBatch;
  tent: Tent;
  phase: ComponentPhase;
  earliestNext: number | null;
  countdown: string;
  releasable: boolean;
  readOnly: boolean;
}

interface StationContextValue {
  state: StationState;
  now: number;
  view: ViewKey;
  focusBatchId: string | null;
  focusComponentId: string | null;
  toasts: Toast[];
  setView: (v: ViewKey) => void;
  gotoBatch: (id: string, view?: ViewKey) => void;
  gotoComponent: (id: string, view?: ViewKey) => void;
  pushToast: (level: Toast["level"], text: string) => void;
  dismissToast: (id: number) => void;
  registerBatch: (input: RegisterInput) => RegisterOutcome;
  addRecheck: (batchId: string, input: RecheckInput) => boolean;
  release: (batchId: string) => boolean;
  patchComponent: (id: string, patch: ComponentPatch) => boolean;
  createComponent: (draft: NewComponentDraft) => string;
  resetDemo: () => void;
  // 派生
  componentPhase: (id: string) => ComponentPhase;
  componentBatch: (id: string) => FumigationBatch | undefined;
  queueRows: () => QueueRow[];
  busyComponents: Set<string>;
  occupiedTents: Set<string>;
  tentName: (id: string) => string;
  chemicalOf: (code: string) => ChemicalStock | undefined;
}

const StationContext = createContext<StationContextValue | null>(null);

const TICK_MS = 30_000;

export function StationProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<StationState>(() => loadState() ?? createSeedState(Date.now()));
  const [now, setNow] = useState<number>(() => Date.now());
  const [view, setView] = useState<ViewKey>("list");
  const [focusBatchId, setFocusBatchId] = useState<string | null>(null);
  const [focusComponentId, setFocusComponentId] = useState<string | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const toastSeq = useRef(0);

  // 台账变更即落盘：刷新后清单 / 队列 / 关系图读到同一份数据
  useEffect(() => {
    saveState(state);
  }, [state]);

  // 驱动复检倒计时与"已满 24 小时"判定
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), TICK_MS);
    return () => window.clearInterval(timer);
  }, []);

  const pushToast = useCallback((level: Toast["level"], text: string) => {
    const id = ++toastSeq.current;
    setToasts((prev) => [...prev, { id, level, text }]);
    window.setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 5200);
  }, []);

  const dismissToast = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const gotoBatch = useCallback((id: string, nextView: ViewKey = "queue") => {
    setFocusBatchId(id);
    setView(nextView);
  }, []);

  const gotoComponent = useCallback((id: string, nextView: ViewKey = "list") => {
    setFocusComponentId(id);
    setView(nextView);
  }, []);

  const registerBatch = useCallback(
    (input: RegisterInput): RegisterOutcome => {
      let outcome: RegisterOutcome = { accepted: false, kind: "denied" };
      setState((prev) => {
        const result = applyRegister(prev, input, Date.now());
        const o = result.outcome as RegisterOutcome;
        outcome = o;
        if (o.kind === "reused") {
          pushToast("warn", o.reason ?? "该仓罩仅接一批，沿用首批。");
        } else if (o.kind === "denied") {
          pushToast("error", o.reason ?? "整批拒绝。");
        } else {
          const id = result.state.batches[result.state.batches.length - 1]?.id;
          pushToast("ok", `批次 ${id ?? ""} 登记成功，进入熏蒸密闭。`);
          if (id) setFocusBatchId(id);
        }
        return result.state;
      });
      return outcome;
    },
    [pushToast],
  );

  const addRecheck = useCallback(
    (batchId: string, input: RecheckInput): boolean => {
      let ok = false;
      setState((prev) => {
        const result = applyRecheck(prev, batchId, input, Date.now());
        ok = result.outcome.accepted;
        pushToast(
          result.outcome.accepted ? "ok" : "error",
          result.outcome.reason ?? (result.outcome.accepted ? "复检已记录。" : "复检被拒收。"),
        );
        return result.state;
      });
      return ok;
    },
    [pushToast],
  );

  const release = useCallback(
    (batchId: string): boolean => {
      let ok = false;
      setState((prev) => {
        const result = applyRelease(prev, batchId, Date.now());
        ok = result.ok;
        pushToast(
          result.ok ? "ok" : "error",
          result.ok
            ? `批次 ${batchId} 蛀屑无新增、浓度回落，构件复位放行，仓罩释放。`
            : result.reason ?? "不能放行。",
        );
        return result.state;
      });
      return ok;
    },
    [pushToast],
  );

  const patchComponent = useCallback(
    (id: string, patch: ComponentPatch): boolean => {
      let ok = false;
      setState((prev) => {
        const result = updateComponent(prev, id, patch, Date.now());
        ok = true;
        if (result.critical) {
          result.invalidatedBatches.forEach((b) => {
            pushToast(
              "warn",
              `关键信息变更：批次 ${b.id} ${b.invalidateReason ?? "已作废，原放行失效重算，旧批只读。"}`,
            );
          });
        }
        return result.state;
      });
      return ok;
    },
    [pushToast],
  );

  const createComponent = useCallback((draft: NewComponentDraft): string => {
    let newId = "";
    setState((prev) => {
      const result = addComponent(prev, draft);
      newId = result.id;
      return result.state;
    });
    return newId;
  }, []);

  const resetDemo = useCallback(() => {
    clearPersistedState();
    setState(createSeedState(Date.now()));
    setFocusBatchId(null);
    setFocusComponentId(null);
    pushToast("ok", "已恢复演示台账。");
  }, [pushToast]);

  // 派生选择器：三处视图同源
  const componentPhase = useCallback(
    (id: string): ComponentPhase => phaseOf(id, state.batches, now),
    [state.batches, now],
  );

  const componentBatch = useCallback(
    (id: string): FumigationBatch | undefined => {
      const rows = state.batches
        .filter((b) => b.componentIds.includes(id))
        .sort((a, b) => b.seq - a.seq);
      return rows[0];
    },
    [state.batches],
  );

  const busyComponents = useMemo(() => busyComponentIds(state.batches), [state.batches]);
  const occupiedTents = useMemo(() => occupiedTentIds(state.batches), [state.batches]);

  const tentName = useCallback(
    (id: string) => state.tents.find((t) => t.id === id)?.name ?? id,
    [state.tents],
  );

  const chemicalOf = useCallback(
    (code: string) => state.chemicals.find((c) => c.code === code),
    [state.chemicals],
  );

  const queueRows = useCallback((): QueueRow[] => {
    return state.batches
      .filter((b) => b.status === "fumigating")
      .sort((a, b) => a.seq - b.seq)
      .map((batch) => {
        const firstId = batch.componentIds[0];
        const earliest = nextRecheckEarliest(batch);
        return {
          batch,
          tent: state.tents.find((t) => t.id === batch.tentId) ?? {
            id: batch.tentId,
            name: batch.tentId,
          },
          phase: phaseOf(firstId, state.batches, now),
          earliestNext: earliest,
          countdown: earliest ? formatCountdown(earliest - now) : "",
          releasable: canRelease(batch),
          readOnly: false,
        };
      });
  }, [state.batches, state.tents, now]);

  const value: StationContextValue = {
    state,
    now,
    view,
    focusBatchId,
    focusComponentId,
    toasts,
    setView,
    gotoBatch,
    gotoComponent,
    pushToast,
    dismissToast,
    registerBatch,
    addRecheck,
    release,
    patchComponent,
    createComponent,
    resetDemo,
    componentPhase,
    componentBatch,
    queueRows,
    busyComponents,
    occupiedTents,
    tentName,
    chemicalOf,
  };

  return <StationContext.Provider value={value}>{children}</StationContext.Provider>;
}

export function useStation(): StationContextValue {
  const ctx = useContext(StationContext);
  if (!ctx) throw new Error("useStation 必须在 StationProvider 内使用");
  return ctx;
}

export { PHASE_LABEL };
export type { Component };
