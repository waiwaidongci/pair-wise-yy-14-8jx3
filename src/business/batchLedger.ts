/**
 * 业务文件二：批次账。
 * 批次与流水的唯一写入口（纯函数、只追加不篡改），
 * 并提供清单 / 隔离队列 / 关系图共用的派生口径，保证三处刷新后一致。
 */
import {
  judgeInvalidation,
  judgeRecheck,
  judgeRegistration,
  judgeRelease,
  REQUIRED_RECHECKS,
  type RegistrationInput,
} from "./fumigationRules";
import type {
  Chemical,
  ComponentStage,
  FumigationBatch,
  Ledger,
  LedgerEvent,
  LedgerEventKind,
  Recheck,
  SurveyComponent,
} from "./types";

export const emptyLedger: Ledger = { batches: [], events: [] };

function nextId(prefix: string, count: number): string {
  return `${prefix}-${String(count + 1).padStart(4, "0")}`;
}

function appendEvent(ledger: Ledger, event: Omit<LedgerEvent, "id">): Ledger {
  return {
    ...ledger,
    events: [...ledger.events, { ...event, id: nextId("E", ledger.events.length) }],
  };
}

export interface RegisterOutcome {
  ledger: Ledger;
  batch: FumigationBatch;
  reused: boolean; // 仓罩重复登记，沿用首次
}

/**
 * 登记批次。同一仓罩仅接一批：仓罩下已有被接收入仓的批次时，
 * 不再开新批，直接沿用首次；整批拒绝的批次未入仓，不占仓罩。
 */
export function registerBatch(
  ledger: Ledger,
  input: RegistrationInput,
  chemicals: Chemical[],
  components: SurveyComponent[],
  now: number,
): RegisterOutcome {
  const tentId = input.tentId.trim();
  const existing = ledger.batches.find(
    (b) => b.tentId === tentId && b.status !== "rejected",
  );
  if (existing) {
    return {
      ledger: appendEvent(ledger, {
        at: now,
        batchId: existing.id,
        tentId,
        kind: "reuse",
        detail: `仓罩 ${tentId} 重复登记，仅接一批，沿用首次批次 ${existing.id}`,
      }),
      batch: existing,
      reused: true,
    };
  }

  const decision = judgeRegistration({ ...input, tentId }, chemicals, now);
  const chemical = chemicals.find((c) => c.batchNo === input.chemicalBatchNo);
  const batch: FumigationBatch = {
    id: nextId("B", ledger.batches.length),
    tentId,
    componentIds: [...input.componentIds],
    chemicalBatchNo: input.chemicalBatchNo,
    chemicalName: chemical?.name ?? "未知药剂",
    concentration: input.concentration,
    pressure: input.pressure,
    applicator: input.applicator.trim(),
    createdAt: now,
    status: decision.ok ? "active" : "rejected",
    readonly: !decision.ok,
    note: decision.ok ? "" : decision.reason,
    rechecks: [],
    releasedAt: null,
    revisionSnapshot: Object.fromEntries(
      components
        .filter((c) => input.componentIds.includes(c.id))
        .map((c) => [c.id, c.revision]),
    ),
  };
  const kind: LedgerEventKind = decision.ok ? "register" : "reject";
  const detail = decision.ok
    ? `登记入仓：${batch.componentIds.length} 件构件，药剂 ${batch.chemicalName}（${batch.chemicalBatchNo}），浓度 ${batch.concentration}g/m³，仓压 ${batch.pressure}Pa，施药人 ${batch.applicator}`
    : `整批拒绝：${decision.reason}`;
  return {
    ledger: appendEvent(
      { ...ledger, batches: [...ledger.batches, batch] },
      { at: now, batchId: batch.id, tentId, kind, detail },
    ),
    batch,
    reused: false,
  };
}

export interface RecheckInput {
  inspector: string;
  frassNew: boolean;
  residual: number;
}

export interface WriteOutcome {
  ledger: Ledger;
  error: string | null;
}

/** 复检入账：非施药人、两次、间隔二十四小时，由判定文件把关 */
export function recordRecheck(
  ledger: Ledger,
  batchId: string,
  input: RecheckInput,
  now: number,
): WriteOutcome {
  const batch = ledger.batches.find((b) => b.id === batchId);
  if (!batch) return { ledger, error: "批次不存在" };
  const decision = judgeRecheck(batch, input.inspector, now);
  if (!decision.ok) return { ledger, error: decision.reason };
  const recheck: Recheck = {
    id: nextId("R", batch.rechecks.length),
    inspector: input.inspector.trim(),
    at: now,
    frassNew: input.frassNew,
    residual: input.residual,
  };
  const batches = ledger.batches.map((b) =>
    b.id === batchId ? { ...b, rechecks: [...b.rechecks, recheck] } : b,
  );
  const detail = `第 ${batch.rechecks.length + 1} 次复检：${recheck.inspector}，蛀屑${
    recheck.frassNew ? "有" : "无"
  }新增，残留浓度 ${recheck.residual}g/m³`;
  return {
    ledger: appendEvent(
      { ...ledger, batches },
      { at: now, batchId, tentId: batch.tentId, kind: "recheck", detail },
    ),
    error: null,
  };
}

/** 复位放行：两次复检合格、蛀屑无新增且浓度回落才入账 */
export function releaseBatch(
  ledger: Ledger,
  batchId: string,
  now: number,
): WriteOutcome {
  const batch = ledger.batches.find((b) => b.id === batchId);
  if (!batch) return { ledger, error: "批次不存在" };
  const decision = judgeRelease(batch);
  if (!decision.ok) return { ledger, error: decision.reason };
  const batches = ledger.batches.map((b) =>
    b.id === batchId
      ? {
          ...b,
          status: "released" as const,
          readonly: true,
          releasedAt: now,
          note: "蛀屑无新增且浓度回落，准予复位放行",
        }
      : b,
  );
  return {
    ledger: appendEvent(
      { ...ledger, batches },
      {
        at: now,
        batchId,
        tentId: batch.tentId,
        kind: "release",
        detail: `${REQUIRED_RECHECKS} 次复检合格，蛀屑无新增、浓度回落，复位放行`,
      },
    ),
    error: null,
  };
}

/**
 * 构件尺寸 / 病害 / 换件变更后的失效重算：
 * 涉及的处理中或已放行批次一律失效，旧批只读，等待另开新批重算。
 */
export function invalidateForComponent(
  ledger: Ledger,
  componentId: string,
  cause: string,
  now: number,
): { ledger: Ledger; invalidated: string[] } {
  const hit = ledger.batches.filter(
    (b) => b.componentIds.includes(componentId) && judgeInvalidation(b),
  );
  if (hit.length === 0) return { ledger, invalidated: [] };
  const ids = new Set(hit.map((b) => b.id));
  const batches = ledger.batches.map((b) =>
    ids.has(b.id)
      ? { ...b, status: "invalidated" as const, readonly: true, note: cause }
      : b,
  );
  let next: Ledger = { ...ledger, batches };
  for (const b of hit) {
    next = appendEvent(next, {
      at: now,
      batchId: b.id,
      tentId: b.tentId,
      kind: "invalidate",
      detail: `${cause}，原放行失效重算，旧批只读`,
    });
  }
  return { ledger: next, invalidated: hit.map((b) => b.id) };
}

/* ---------- 派生口径：清单、隔离队列、关系图共用，刷新后一致 ---------- */

export interface ComponentRow extends SurveyComponent {
  stage: ComponentStage;
  batchId: string | null;
  tentId: string | null;
}

/** 构件清单行：取含该构件的最新一个入仓批次定状态 */
export function selectComponentRows(
  components: SurveyComponent[],
  ledger: Ledger,
): ComponentRow[] {
  return components.map((c) => {
    const batch = [...ledger.batches]
      .reverse()
      .find((b) => b.componentIds.includes(c.id) && b.status !== "rejected");
    const stage: ComponentStage = !batch
      ? "待处理"
      : batch.status === "active"
        ? "隔离中"
        : batch.status === "released"
          ? "已放行"
          : "待重算";
    return { ...c, stage, batchId: batch?.id ?? null, tentId: batch?.tentId ?? null };
  });
}

/** 隔离队列：处理期间的批次 */
export function selectIsolationQueue(ledger: Ledger): FumigationBatch[] {
  return ledger.batches.filter((b) => b.status === "active");
}

/** 历史批次（只读）：放行 / 拒绝 / 失效 */
export function selectBatchHistory(ledger: Ledger): FumigationBatch[] {
  return ledger.batches.filter((b) => b.status !== "active").slice().reverse();
}

export interface GraphNode {
  id: string;
  label: string;
  kind: "building" | "component";
  stage: ComponentStage | null;
}

export interface GraphEdge {
  id: string;
  from: string;
  to: string;
  kind: "belong" | "batch";
}

export interface RelationGraph {
  buildings: string[];
  nodes: GraphNode[];
  edges: GraphEdge[];
}

/** 关系图：建筑—构件从属边 + 同仓罩同批熏蒸边 */
export function selectRelationGraph(
  components: SurveyComponent[],
  ledger: Ledger,
): RelationGraph {
  const rows = selectComponentRows(components, ledger);
  const buildings = [...new Set(components.map((c) => c.building))];
  const nodes: GraphNode[] = [
    ...buildings.map((b) => ({
      id: `building:${b}`,
      label: b,
      kind: "building" as const,
      stage: null,
    })),
    ...rows.map((r) => ({
      id: r.id,
      label: r.code,
      kind: "component" as const,
      stage: r.stage,
    })),
  ];
  const edges: GraphEdge[] = rows.map((r) => ({
    id: `belong:${r.id}`,
    from: `building:${r.building}`,
    to: r.id,
    kind: "belong",
  }));
  for (const batch of selectIsolationQueue(ledger)) {
    for (let i = 0; i + 1 < batch.componentIds.length; i += 1) {
      edges.push({
        id: `batch:${batch.id}:${i}`,
        from: batch.componentIds[i],
        to: batch.componentIds[i + 1],
        kind: "batch",
      });
    }
  }
  return { buildings, nodes, edges };
}

export interface Metric {
  label: string;
  value: number;
}

export function selectMetrics(
  components: SurveyComponent[],
  ledger: Ledger,
): Metric[] {
  void components;
  const active = selectIsolationQueue(ledger);
  const isolated = new Set(active.flatMap((b) => b.componentIds)).size;
  const pendingRecheck = active.filter(
    (b) => b.rechecks.length < REQUIRED_RECHECKS,
  ).length;
  const released = ledger.batches.filter((b) => b.status === "released").length;
  return [
    { label: "在熏批次", value: active.length },
    { label: "隔离构件", value: isolated },
    { label: "待复检批次", value: pendingRecheck },
    { label: "已放行批次", value: released },
  ];
}
