// 白蚁熏蒸放行台 —— 批次账层
// 职责：台账数据结构与纯状态流转（登记/拒批留痕、复检、放行、作废、构件变更）、
//      localStorage 持久化与演示账初始化。不含任何界面代码。

import {
  Component,
  ComponentSnapshot,
  FumigationBatch,
  RecheckInput,
  RegisterInput,
  RegisterOutcome,
  RecheckOutcome,
  SAFE_RESIDUAL_PPM,
  Tent,
  canRelease,
  evaluateRecheck,
  evaluateRegister,
  isCriticalChange,
  isLive,
  snapshotKey,
  snapshotOf,
} from "./rules";

const STORAGE_KEY = "termite-fumigation-station-v1";

export interface ChemicalStock {
  code: string; // 药剂批次号
  name: string; // 药剂名称
  expiry: string; // 有效期 yyyy-mm-dd
}

export interface StationState {
  version: 1;
  seq: number; // 批次序号游标
  components: Component[];
  batches: FumigationBatch[];
  tents: Tent[];
  chemicals: ChemicalStock[];
  operators: string[];
}

export interface MutationResult {
  state: StationState;
  outcome: RegisterOutcome | RecheckOutcome;
}

export function makeBatchId(startedAt: number, seq: number): string {
  const d = new Date(startedAt);
  const p = (n: number) => String(n).padStart(2, "0");
  return `FM-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${String(
    seq,
  ).padStart(2, "0")}`;
}

/* -------------------------------- 登记 / 拒批 -------------------------------- */

export function applyRegister(
  state: StationState,
  input: RegisterInput,
  now: number,
): MutationResult {
  const outcome = evaluateRegister(input, state.batches, now);

  // 同罩沿用首批：台账不新增
  if (outcome.kind === "reused") return { state, outcome };

  const seq = state.seq + 1;
  const base = {
    id: makeBatchId(input.startedAt, seq),
    tentId: input.tentId,
    componentIds: [...input.componentIds],
    chemical: input.chemical.trim(),
    expiry: input.expiry,
    dose: input.dose,
    pressure: input.pressure,
    applicator: input.applicator.trim(),
    startedAt: input.startedAt,
    rechecks: [],
    seq,
  };

  // 药剂过期 / 仓压不足：整批拒绝，仍入留痕账（只读），不占用仓罩
  if (outcome.kind === "denied") {
    const rejected: FumigationBatch = {
      ...base,
      status: "rejected",
      rejectReason: outcome.reason,
    };
    return {
      state: { ...state, seq, batches: [...state.batches, rejected] },
      outcome,
    };
  }

  const created: FumigationBatch = { ...base, status: "fumigating" };
  return {
    state: { ...state, seq, batches: [...state.batches, created] },
    outcome,
  };
}

/* ---------------------------------- 复检 ---------------------------------- */

export function applyRecheck(
  state: StationState,
  batchId: string,
  input: RecheckInput,
  now: number,
): MutationResult {
  const batch = state.batches.find((b) => b.id === batchId);
  if (!batch) {
    return {
      state,
      outcome: { accepted: false, reason: "批次不存在。" },
    };
  }
  const outcome = evaluateRecheck(batch, input, now);
  if (!outcome.accepted) return { state, outcome };

  const recheck = {
    at: input.at,
    inspector: input.inspector.trim(),
    residualPpm: input.residualPpm,
    newFrass: input.newFrass,
  };
  const round = batch.rechecks.length + 1;

  // 新增蛀屑 → 立即作废；第二次复检浓度未回落 → 作废
  const frassFail = input.newFrass;
  const residualFail =
    !input.newFrass &&
    input.residualPpm > SAFE_RESIDUAL_PPM &&
    round === 2;

  let next: FumigationBatch;
  if (frassFail || residualFail) {
    next = {
      ...batch,
      rechecks: [...batch.rechecks, recheck],
      status: "invalidated",
      invalidateReason:
        round === 1
          ? "首次复检发现蛀屑新增，熏蒸未根除，本批作废，须重新熏蒸。"
          : frassFail
            ? "第二次复检发现蛀屑新增，本批作废，须重新熏蒸。"
            : `第二次复检残留 ${input.residualPpm}ppm 未回落至安全值，本批作废，须重新熏蒸。`,
    };
  } else {
    next = { ...batch, rechecks: [...batch.rechecks, recheck] };
  }

  return {
    state: {
      ...state,
      batches: state.batches.map((b) => (b.id === batchId ? next : b)),
    },
    outcome,
  };
}

/* --------------------------------- 复位放行 --------------------------------- */

export interface ReleaseResult {
  state: StationState;
  ok: boolean;
  reason?: string;
}

export function applyRelease(
  state: StationState,
  batchId: string,
  now: number,
): ReleaseResult {
  const batch = state.batches.find((b) => b.id === batchId);
  if (!batch) return { state, ok: false, reason: "批次不存在。" };
  if (!canRelease(batch)) {
    return { state, ok: false, reason: "尚未满足两次复检合格，不能复位放行。" };
  }
  const snapshots: Record<string, ComponentSnapshot> = {};
  state.components.forEach((c) => {
    if (batch.componentIds.includes(c.id)) snapshots[c.id] = snapshotOf(c);
  });
  const next: FumigationBatch = {
    ...batch,
    status: "released",
    releasedAt: now,
    releasedSnapshots: snapshots,
  };
  return {
    state: {
      ...state,
      batches: state.batches.map((b) => (b.id === batchId ? next : b)),
    },
    ok: true,
  };
}

/* --------------------------- 关键信息变更 → 失效重算 --------------------------- */

export interface ComponentPatch {
  building?: string;
  code?: string;
  wood?: string;
  joint?: string;
  section?: string;
  disease?: string;
  replaced?: boolean;
  advice?: string;
}

export interface UpdateResult {
  state: StationState;
  critical: boolean;
  invalidatedBatches: FumigationBatch[];
}

/**
 * 修改构件。截面尺寸 / 病害 / 换件为关键信息：
 *  - revision +1；
 *  - 该构件所在的运行批（熏蒸中或已放行）一律作废，旧批只读；
 *  - 已放行批：原放行失效重算；熏蒸中批：处理期间变更，终止重算。
 * 其余字段（建筑/编号/木种/榫卯/建议）改动不影响放行。
 */
export function updateComponent(
  state: StationState,
  componentId: string,
  patch: ComponentPatch,
  now: number,
): UpdateResult {
  const before = state.components.find((c) => c.id === componentId);
  if (!before) return { state, critical: false, invalidatedBatches: [] };

  const critical = isCriticalChange(before, patch);
  const changed: string[] = [];
  if (patch.section !== undefined && patch.section !== before.section)
    changed.push("截面尺寸");
  if (patch.disease !== undefined && patch.disease !== before.disease)
    changed.push("病害记录");
  if (patch.replaced !== undefined && patch.replaced !== before.replaced)
    changed.push(patch.replaced ? "换件" : "撤销换件");

  const updated: Component = {
    ...before,
    ...patch,
    revision: critical ? before.revision + 1 : before.revision,
  };

  let invalidatedBatches: FumigationBatch[] = [];
  let batches = state.batches;

  if (critical) {
    batches = state.batches.map((b) => {
      const hit =
        isLive(b) && b.componentIds.includes(componentId);
      if (!hit) return b;
      const wasReleased = b.status === "released";
      const next: FumigationBatch = {
        ...b,
        status: "invalidated",
        invalidateReason: `${wasReleased ? "复位放行后" : "熏蒸处理期间"}修改${changed.join(
          "、",
        )}（rev.${before.revision}→rev.${updated.revision}），${
          wasReleased ? "原放行失效" : "处理依据变化"
        }重算，旧批只读，须重新熏蒸。`,
        releasedAt: wasReleased ? b.releasedAt ?? now : undefined,
      };
      invalidatedBatches.push(next);
      return next;
    });
  }

  return {
    state: {
      ...state,
      components: state.components.map((c) => (c.id === componentId ? updated : c)),
      batches,
    },
    critical,
    invalidatedBatches,
  };
}

/* --------------------------------- 新增构件 --------------------------------- */

export interface NewComponentDraft {
  building: string;
  code: string;
  wood: string;
  joint: string;
  section: string;
  disease: string;
  advice: string;
}

export function addComponent(
  state: StationState,
  draft: NewComponentDraft,
): { state: StationState; id: string } {
  const id = `CP-${String(state.components.length + 1).padStart(3, "0")}`;
  const component: Component = {
    id,
    replaced: false,
    revision: 1,
    ...draft,
  };
  return {
    state: { ...state, components: [...state.components, component] },
    id,
  };
}

/** 一致性校验：清单 / 隔离队列 / 关系图共用同一派生口径 */
export function snapshotsMatch(
  batch: FumigationBatch,
  components: Component[],
): boolean {
  if (!batch.releasedSnapshots) return true;
  const byId = new Map(components.map((c) => [c.id, c]));
  return batch.componentIds.every((id) => {
    const c = byId.get(id);
    const s = batch.releasedSnapshots![id];
    return c && s && snapshotKey(snapshotOf(c)) === snapshotKey(s);
  });
}

/* --------------------------------- 持久化 ---------------------------------- */

export function saveState(state: StationState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // 存储不可用时静默降级为内存态
  }
}

export function loadState(): StationState | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StationState;
    if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.batches))
      return null;
    return parsed;
  } catch {
    return null;
  }
}

export function clearPersistedState(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}

/* --------------------------------- 演示账 ---------------------------------- */

const DAY = 24 * 60 * 60 * 1000;
const HOUR = 60 * 60 * 1000;

export function createSeedState(now: number): StationState {
  const components: Component[] = [
    {
      id: "CP-001",
      building: "清一堂",
      code: "梁架A-03",
      wood: "金丝楠木",
      joint: "透榫",
      section: "180×240mm",
      disease: "梁端蛀屑散落，表层蚁路",
      replaced: false,
      advice: "熏蒸后观察，端部嵌补",
      revision: 1,
    },
    {
      id: "CP-002",
      building: "清一堂",
      code: "柱网C-12",
      wood: "楠木",
      joint: "管脚榫",
      section: "Φ320mm",
      disease: "柱脚糟朽伴蚁路延伸",
      replaced: false,
      advice: "墩接前先根除蚁患",
      revision: 1,
    },
    {
      id: "CP-003",
      building: "清一堂",
      code: "斗拱D-07",
      wood: "柏木",
      joint: "半榫",
      section: "120×160mm",
      disease: "斗瓣轻微虫蛀，蛀孔新鲜",
      replaced: false,
      advice: "整攒罩熏蒸",
      revision: 1,
    },
    {
      id: "CP-004",
      building: "清一堂",
      code: "梁架B-05",
      wood: "松木",
      joint: "燕尾榫",
      section: "150×200mm",
      disease: "未见蛀屑（预检通过）",
      replaced: false,
      advice: "例行监测",
      revision: 1,
    },
    {
      id: "CP-005",
      building: "藏经阁",
      code: "柱网E-02",
      wood: "杉木",
      joint: "箍头榫",
      section: "Φ280mm",
      disease: "柱头蚁巢残迹，蛀屑堆积",
      replaced: false,
      advice: "须重新登记熏蒸",
      revision: 1,
    },
    {
      id: "CP-006",
      building: "藏经阁",
      code: "斗拱F-09",
      wood: "樟木",
      joint: "透榫",
      section: "100×140mm",
      disease: "坐斗表面蛀孔，待罩熏",
      replaced: false,
      advice: "排队待熏",
      revision: 1,
    },
    {
      id: "CP-007",
      building: "藏经阁",
      code: "梁架G-01",
      wood: "榆木",
      joint: "半榫",
      section: "160×220mm",
      disease: "榫颈虫蛀糟朽，已配换雀替",
      replaced: true,
      advice: "换件后需重新熏蒸",
      revision: 2,
    },
    {
      id: "CP-008",
      building: "山门",
      code: "柱网H-08",
      wood: "楠木",
      joint: "管脚榫",
      section: "Φ300mm",
      disease: "柱础边缘新鲜蛀屑",
      replaced: false,
      advice: "优先安排仓罩",
      revision: 1,
    },
  ];

  const tents: Tent[] = [
    { id: "Z-01", name: "一号仓罩·梁架区" },
    { id: "Z-02", name: "二号仓罩·柱网区" },
    { id: "Z-03", name: "三号仓罩·斗拱区" },
    { id: "Z-04", name: "四号仓罩·备用" },
    { id: "Z-05", name: "五号仓罩·备用" },
  ];

  const chemicals: ChemicalStock[] = [
    { code: "SF-2025-118", name: "硫酰氟", expiry: "2027-03-31" },
    { code: "MB-2026-004", name: "溴甲烷", expiry: "2027-06-30" },
    { code: "SF-2024-077", name: "硫酰氟（旧批）", expiry: "2025-08-31" },
  ];

  const operators = ["王德福", "陈守木", "赵青山", "林素贞", "孙广亮"];

  const snap = (id: string) =>
    snapshotOf(components.find((c) => c.id === id)!);

  const batches: FumigationBatch[] = [
    {
      // 批1：两次复检合格，已复位放行（仓罩随之归档占用）
      id: makeBatchId(now - 3 * DAY, 1),
      seq: 1,
      tentId: "Z-01",
      componentIds: ["CP-001"],
      chemical: "SF-2025-118",
      expiry: "2027-03-31",
      dose: 36,
      pressure: 320,
      applicator: "王德福",
      startedAt: now - 3 * DAY,
      status: "released",
      rechecks: [
        { at: now - 2 * DAY - 2 * HOUR, inspector: "林素贞", residualPpm: 4, newFrass: false },
        { at: now - DAY - HOUR, inspector: "孙广亮", residualPpm: 2, newFrass: false },
      ],
      releasedAt: now - DAY - HOUR,
      releasedSnapshots: { "CP-001": snap("CP-001") },
    },
    {
      // 批2：首检合格，已满 24h，等待第二次复检
      id: makeBatchId(now - 2 * DAY - 3 * HOUR, 2),
      seq: 2,
      tentId: "Z-02",
      componentIds: ["CP-002"],
      chemical: "SF-2025-118",
      expiry: "2027-03-31",
      dose: 32,
      pressure: 300,
      applicator: "陈守木",
      startedAt: now - 2 * DAY - 3 * HOUR,
      status: "fumigating",
      rechecks: [
        { at: now - 30 * HOUR, inspector: "林素贞", residualPpm: 3, newFrass: false },
      ],
    },
    {
      // 批3：刚施药 7 小时，密闭中
      id: makeBatchId(now - 7 * HOUR, 3),
      seq: 3,
      tentId: "Z-03",
      componentIds: ["CP-003"],
      chemical: "MB-2026-004",
      expiry: "2027-06-30",
      dose: 28,
      pressure: 260,
      applicator: "赵青山",
      startedAt: now - 7 * HOUR,
      status: "fumigating",
      rechecks: [],
    },
    {
      // 批4：仓压不足，整批拒绝（留痕只读，不占仓罩）
      id: makeBatchId(now - DAY, 4),
      seq: 4,
      tentId: "Z-04",
      componentIds: ["CP-005"],
      chemical: "SF-2025-118",
      expiry: "2027-03-31",
      dose: 30,
      pressure: 180,
      applicator: "王德福",
      startedAt: now - DAY,
      status: "rejected",
      rejectReason: "仓压 180Pa 低于最低要求 250Pa，整批拒绝。",
      rechecks: [],
    },
    {
      // 批5：曾放行，放行后换件 → 原放行失效重算，旧批只读
      id: makeBatchId(now - 4 * DAY, 5),
      seq: 5,
      tentId: "Z-05",
      componentIds: ["CP-007"],
      chemical: "SF-2025-118",
      expiry: "2027-03-31",
      dose: 34,
      pressure: 290,
      applicator: "陈守木",
      startedAt: now - 4 * DAY,
      status: "invalidated",
      rechecks: [
        { at: now - 3 * DAY, inspector: "孙广亮", residualPpm: 3, newFrass: false },
        { at: now - 2 * DAY - 2 * HOUR, inspector: "林素贞", residualPpm: 2, newFrass: false },
      ],
      releasedAt: now - 2 * DAY,
      releasedSnapshots: {
        "CP-007": {
          section: "160×220mm",
          disease: "榫颈虫蛀糟朽",
          replaced: false,
          revision: 1,
        },
      },
      invalidateReason:
        "复位放行后修改换件（rev.1→rev.2），原放行失效重算，旧批只读，须重新熏蒸。",
    },
  ];

  return { version: 1, seq: 5, components, batches, tents, chemicals, operators };
}
