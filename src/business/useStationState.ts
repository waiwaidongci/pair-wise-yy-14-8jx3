/**
 * 业务文件三：界面状态。
 * 持有页面唯一状态源（构件、药剂、批次账、演示时钟、筛选、反馈），
 * 所有写操作经批次账入账；清单、隔离队列、关系图均由同一状态派生，
 * 并持久化到 localStorage，刷新后三处视图保持一致。
 */
import { useEffect, useMemo, useReducer } from "react";
import {
  invalidateForComponent,
  recordRecheck,
  registerBatch,
  releaseBatch,
  selectBatchHistory,
  selectComponentRows,
  selectIsolationQueue,
  selectMetrics,
  selectRelationGraph,
} from "./batchLedger";
import type { RegistrationInput } from "./fumigationRules";
import type { Chemical, Ledger, SurveyComponent } from "./types";
import { seedChemicals, seedComponents, seedLedger } from "../data/seed";

const STORAGE_KEY = "hxyfront-62013-station-v1";
const DAY = 24 * 60 * 60 * 1000;

export interface StationState {
  components: SurveyComponent[];
  chemicals: Chemical[];
  ledger: Ledger;
  clockOffsetMs: number; // 演示时钟偏移，用于满足复检二十四小时间隔
  buildingFilter: string; // "全部" | 建筑名称
  notice: string; // 最近一次操作反馈
}

export type StationAction =
  | { type: "register"; input: RegistrationInput; wallNow: number }
  | {
      type: "recheck";
      batchId: string;
      inspector: string;
      frassNew: boolean;
      residual: number;
      wallNow: number;
    }
  | { type: "release"; batchId: string; wallNow: number }
  | {
      type: "revise";
      componentId: string;
      section: string;
      disease: string;
      partReplaced: boolean;
      wallNow: number;
    }
  | { type: "filterBuilding"; building: string }
  | { type: "advanceClock" }
  | { type: "reset"; wallNow: number };

function seedState(wallNow: number): StationState {
  const components = seedComponents();
  const chemicals = seedChemicals(wallNow);
  return {
    components,
    chemicals,
    ledger: seedLedger(wallNow, components, chemicals),
    clockOffsetMs: 0,
    buildingFilter: "全部",
    notice: "演示数据已就绪",
  };
}

function reducer(state: StationState, action: StationAction): StationState {
  const now =
    ("wallNow" in action ? action.wallNow : Date.now()) + state.clockOffsetMs;
  switch (action.type) {
    case "register": {
      const outcome = registerBatch(
        state.ledger,
        action.input,
        state.chemicals,
        state.components,
        now,
      );
      const notice = outcome.reused
        ? `仓罩 ${outcome.batch.tentId} 仅接一批，已沿用首次批次 ${outcome.batch.id}（旧批只读）`
        : outcome.batch.status === "rejected"
          ? `整批拒绝：${outcome.batch.note}`
          : `批次 ${outcome.batch.id} 登记入仓（仓罩 ${outcome.batch.tentId}）`;
      return { ...state, ledger: outcome.ledger, notice };
    }
    case "recheck": {
      const { ledger, error } = recordRecheck(
        state.ledger,
        action.batchId,
        {
          inspector: action.inspector,
          frassNew: action.frassNew,
          residual: action.residual,
        },
        now,
      );
      return {
        ...state,
        ledger,
        notice: error ?? `批次 ${action.batchId} 复检已入账`,
      };
    }
    case "release": {
      const { ledger, error } = releaseBatch(state.ledger, action.batchId, now);
      return {
        ...state,
        ledger,
        notice: error ?? `批次 ${action.batchId} 复位放行，构件可回装`,
      };
    }
    case "revise": {
      const target = state.components.find((c) => c.id === action.componentId);
      if (!target) return state;
      const changed: string[] = [];
      if (action.section !== target.section) changed.push("尺寸");
      if (action.disease !== target.disease) changed.push("病害");
      if (action.partReplaced !== target.partReplaced) changed.push("换件");
      if (changed.length === 0) {
        return { ...state, notice: `构件 ${target.code} 无变更` };
      }
      const components = state.components.map((c) =>
        c.id === target.id
          ? {
              ...c,
              section: action.section,
              disease: action.disease,
              partReplaced: action.partReplaced,
              revision: c.revision + 1,
            }
          : c,
      );
      const cause = `构件 ${target.code} ${changed.join("/")}变更`;
      const { ledger, invalidated } = invalidateForComponent(
        state.ledger,
        target.id,
        cause,
        now,
      );
      const notice =
        invalidated.length > 0
          ? `${cause}，批次 ${invalidated.join("、")} 原放行失效重算，旧批只读`
          : `${cause}，该构件无在账批次，无需重算`;
      return { ...state, components, ledger, notice };
    }
    case "filterBuilding":
      return { ...state, buildingFilter: action.building };
    case "advanceClock":
      return {
        ...state,
        clockOffsetMs: state.clockOffsetMs + DAY,
        notice: "演示时钟已推进 24 小时，可登记下一次复检",
      };
    case "reset":
      return seedState(action.wallNow);
    default:
      return state;
  }
}

function loadState(): StationState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw) as StationState;
  } catch {
    // 存储不可用时回落到种子数据
  }
  return seedState(Date.now());
}

export function useStationState() {
  const [state, dispatch] = useReducer(reducer, null, loadState);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      // 存储不可用时仅保持内存态
    }
  }, [state]);

  /** 派生视图：清单、隔离队列、关系图同源同口径 */
  const derived = useMemo(
    () => ({
      rows: selectComponentRows(state.components, state.ledger),
      queue: selectIsolationQueue(state.ledger),
      history: selectBatchHistory(state.ledger),
      graph: selectRelationGraph(state.components, state.ledger),
      metrics: selectMetrics(state.components, state.ledger),
      events: [...state.ledger.events].reverse(),
      now: Date.now() + state.clockOffsetMs,
    }),
    [state],
  );

  return { state, derived, dispatch };
}
