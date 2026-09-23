// 白蚁熏蒸放行台 —— 业务判定层（纯函数，不含界面与存储）
// 规则要点：
//  1. 同一仓罩仅接一批：运行中批次占用仓罩，重复登记沿用首批；被拒绝/已作废批次不占位。
//  2. 登记药剂批次、浓度、仓压、施药人；药剂过期或仓压不足，整批拒绝（入留痕账，不占用仓罩）。
//  3. 熏蒸后由"非施药人"隔二十四小时复检两次：复检人相同 / 间隔不足 24h 均拒收。
//  4. 蛀屑无新增且浓度回落（残留 ≤ 安全阈值）才可复位放行。
//  5. 处理期间修改截面尺寸 / 病害 / 换件，原放行失效重算，旧批只读封存。

export const HOUR = 60 * 60 * 1000;
export const DAY = 24 * HOUR;

/** 仓压最低要求（Pa，负压熏蒸） */
export const MIN_PRESSURE = 250;
/** 两次复检的最小间隔 */
export const RECHECK_GAP = DAY;
/** 残留浓度安全阈值（ppm，≤ 此值视为浓度回落） */
export const SAFE_RESIDUAL_PPM = 5;
/** 登记时施药浓度范围（g/m³，仅用于输入提示，不决定放行） */
export const DOSE_RANGE = [20, 60] as const;
export const REQUIRED_RECHECKS = 2;

export type BatchStatus =
  | "rejected" // 登记即拒：药剂过期 / 仓压不足（整批拒绝）
  | "fumigating" // 熏蒸中，等待复检
  | "released" // 已复检合格、复位放行
  | "invalidated"; // 原放行/处理失效（处理期间改动关键信息或复检不合格）

export interface Component {
  id: string;
  building: string; // 建筑名称
  code: string; // 构件编号
  wood: string; // 木材种类
  joint: string; // 榫卯类型
  section: string; // 截面尺寸
  disease: string; // 病害（含白蚁蛀屑描述）
  replaced: boolean; // 是否换件
  advice: string; // 修缮建议
  revision: number; // 关键信息版本：尺寸/病害/换件每次改动 +1
}

export interface ComponentSnapshot {
  section: string;
  disease: string;
  replaced: boolean;
  revision: number;
}

export interface Recheck {
  at: number; // 复检时间
  inspector: string; // 复检人（必须非施药人）
  residualPpm: number; // 测得残留浓度
  newFrass: boolean; // 蛀屑是否新增
}

export interface FumigationBatch {
  id: string;
  tentId: string; // 仓罩编号
  componentIds: string[];
  chemical: string; // 药剂（批次号）
  expiry: string; // 有效期 yyyy-mm-dd
  dose: number; // 施药浓度 g/m³
  pressure: number; // 仓压 Pa
  applicator: string; // 施药人
  startedAt: number; // 施药时间
  status: BatchStatus;
  /** 拒绝原因（仅 rejected） */
  rejectReason?: string;
  /** 作废原因（仅 invalidated） */
  invalidateReason?: string;
  rechecks: Recheck[];
  /** 放行时间（仅 released/invalidated 曾放行时） */
  releasedAt?: number;
  /** 放行时锁定的关键信息快照 */
  releasedSnapshots?: Record<string, ComponentSnapshot>;
  /** 登记序号 */
  seq: number;
}

export interface Tent {
  id: string;
  name: string;
}

export interface RegisterInput {
  tentId: string;
  componentIds: string[];
  chemical: string;
  expiry: string;
  dose: number;
  pressure: number;
  applicator: string;
  startedAt: number;
}

export interface RecheckInput {
  inspector: string;
  at: number;
  residualPpm: number;
  newFrass: boolean;
}

export type NoticeLevel = "ok" | "warn" | "error";

export interface RegisterOutcome {
  accepted: boolean;
  /** reused=沿用同罩首批；created=新建；denied=整批拒绝 */
  kind: "reused" | "created" | "denied";
  batchId?: string;
  reason?: string;
}

export interface RecheckOutcome {
  accepted: boolean;
  reason?: string;
  /** 本次后是否两次合格、可复位 */
  releasable?: boolean;
}

/* ---------------------------------- 工具 ---------------------------------- */

export function startOfDay(ts: number): number {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** 有效期 < 当天 即过期（当天仍有效） */
export function isExpired(expiry: string, now: number): boolean {
  if (!expiry) return true;
  const t = new Date(expiry + "T00:00:00").getTime();
  if (Number.isNaN(t)) return true;
  return t < startOfDay(now);
}

export function isPressureSufficient(pressure: number): boolean {
  return Number.isFinite(pressure) && pressure >= MIN_PRESSURE;
}

export function isTerminal(status: BatchStatus): boolean {
  return status === "rejected" || status === "invalidated";
}

/** 运行中（复检 / 已放行）批次：未拒、未作废 */
export function isLive(batch: FumigationBatch): boolean {
  return batch.status === "fumigating" || batch.status === "released";
}

/** 熏蒸进行中（复检未完成、未放行）：占用仓罩 */
export function isFumigating(batch: FumigationBatch): boolean {
  return batch.status === "fumigating";
}

/** 旧批只读：拒绝、作废、已放行均封存；仅熏蒸中可继续复检 */
export function isReadOnly(batch: FumigationBatch): boolean {
  return batch.status !== "fumigating";
}

export function snapshotOf(c: Component): ComponentSnapshot {
  return {
    section: c.section,
    disease: c.disease,
    replaced: c.replaced,
    revision: c.revision,
  };
}

/** 施药时关键信息指纹（放行快照对比用） */
export function snapshotKey(s: ComponentSnapshot): string {
  return `${s.section}${s.disease}${s.replaced ? 1 : 0}`;
}

/* ------------------------------ 仓罩 / 构件占用 ----------------------------- */

/** 仓罩当前占用批（熏蒸中：复检未完成或未复位） */
export function occupyingBatchForTent(
  batches: FumigationBatch[],
  tentId: string,
): FumigationBatch | undefined {
  return batches.find((b) => b.tentId === tentId && isFumigating(b));
}

/** 构件当前所在的处理中批次 */
export function occupyingBatchForComponent(
  batches: FumigationBatch[],
  componentId: string,
): FumigationBatch | undefined {
  return batches.find(
    (b) => isFumigating(b) && b.componentIds.includes(componentId),
  );
}

/** 处理中的构件（不可重复选入新批） */
export function busyComponentIds(batches: FumigationBatch[]): Set<string> {
  const set = new Set<string>();
  batches.forEach((b) => {
    if (isFumigating(b)) b.componentIds.forEach((id) => set.add(id));
  });
  return set;
}

/** 被占用的仓罩集合（放行复位后自动释放，拒绝/作废批次从不占位） */
export function occupiedTentIds(batches: FumigationBatch[]): Set<string> {
  const set = new Set<string>();
  batches.forEach((b) => {
    if (isFumigating(b)) set.add(b.tentId);
  });
  return set;
}

/* --------------------------------- 登记判定 -------------------------------- */

export function evaluateRegister(
  input: RegisterInput,
  batches: FumigationBatch[],
  now: number,
): RegisterOutcome {
  // 1) 同罩处理中（未复位）仅接一批：重复登记沿用首批；放行复位后仓罩释放可接新批
  const existing = occupyingBatchForTent(batches, input.tentId);
  if (existing) {
    return {
      accepted: true,
      kind: "reused",
      batchId: existing.id,
      reason: `仓罩已有运行批次 ${existing.id}，沿用首次登记，不另开新批。`,
    };
  }
  if (input.componentIds.length === 0) {
    return { accepted: false, kind: "denied", reason: "未选择任何构件，无法登记。" };
  }
  if (input.applicator.trim() === "") {
    return { accepted: false, kind: "denied", reason: "施药人不能为空。" };
  }
  if (input.chemical.trim() === "") {
    return { accepted: false, kind: "denied", reason: "药剂批次未登记。" };
  }

  // 2) 药剂过期 或 仓压不足 → 整批拒绝
  const reasons: string[] = [];
  if (isExpired(input.expiry, now)) reasons.push(`药剂 ${input.chemical} 已过有效期（${input.expiry}）`);
  if (!isPressureSufficient(input.pressure))
    reasons.push(`仓压 ${input.pressure}Pa 低于最低要求 ${MIN_PRESSURE}Pa`);
  if (reasons.length > 0) {
    return { accepted: false, kind: "denied", reason: reasons.join("；") + "，整批拒绝。" };
  }
  return { accepted: true, kind: "created" };
}

/* --------------------------------- 复检判定 -------------------------------- */

export function nextRecheckEarliest(batch: FumigationBatch): number | null {
  const last = batch.rechecks[batch.rechecks.length - 1];
  const base = last ? last.at : batch.startedAt;
  return base + RECHECK_GAP;
}

export function evaluateRecheck(
  batch: FumigationBatch,
  input: RecheckInput,
  now: number,
): RecheckOutcome {
  if (batch.status !== "fumigating") {
    return { accepted: false, reason: "批次不在熏蒸中状态，不能复检。" };
  }
  if (batch.rechecks.length >= REQUIRED_RECHECKS) {
    return { accepted: false, reason: "两次复检已完成，应直接判定放行。" };
  }
  if (input.inspector.trim() === "") {
    return { accepted: false, reason: "复检人未签名。" };
  }
  // 非施药人
  if (input.inspector.trim() === batch.applicator.trim()) {
    return {
      accepted: false,
      reason: `复检人不能与施药人为同一人（${batch.applicator}），须换人复检。`,
    };
  }
  const earliest = nextRecheckEarliest(batch)!;
  if (input.at < earliest) {
    return {
      accepted: false,
      reason: `距上次节点不足二十四小时，最早复检时间 ${formatDateTime(earliest)}。`,
    };
  }
  if (input.at > now) {
    return { accepted: false, reason: "复检时间不能晚于当前时间。" };
  }
  // 蛀屑新增 → 处理失败，本批作废重熏
  if (input.newFrass) {
    return { accepted: true, reason: "发现新增蛀屑，本批作废，须重新熏蒸。" };
  }
  // 浓度未回落
  if (input.residualPpm > SAFE_RESIDUAL_PPM) {
    if (batch.rechecks.length === REQUIRED_RECHECKS - 1) {
      return {
        accepted: true,
        reason: `第二次复检残留 ${input.residualPpm}ppm 仍高于 ${SAFE_RESIDUAL_PPM}ppm，未回落，本批作废重熏。`,
      };
    }
    return {
      accepted: true,
      reason: `残留 ${input.residualPpm}ppm 尚未回落（≤${SAFE_RESIDUAL_PPM}ppm），继续密闭，满二十四小时后第二次复检。`,
    };
  }
  const releasable = batch.rechecks.length + 1 >= REQUIRED_RECHECKS;
  return {
    accepted: true,
    releasable,
    reason: releasable
      ? "两次复检完成，蛀屑无新增且浓度回落，可复位放行。"
      : "第一次复检合格，二十四小时后由复检人进行第二次复检。",
  };
}

/* --------------------------------- 放行判定 -------------------------------- */

export function canRelease(batch: FumigationBatch): boolean {
  if (batch.status !== "fumigating") return false;
  if (batch.rechecks.length < REQUIRED_RECHECKS) return false;
  const two = batch.rechecks.slice(0, REQUIRED_RECHECKS);
  return two.every((r) => !r.newFrass && r.residualPpm <= SAFE_RESIDUAL_PPM);
}

/* --------------------------- 关键信息变更 → 失效重算 -------------------------- */

/** 尺寸 / 病害 / 换件 是否构成关键变更 */
export function isCriticalChange(
  before: Component,
  patch: Partial<Pick<Component, "section" | "disease" | "replaced">>,
): boolean {
  return (
    (patch.section !== undefined && patch.section !== before.section) ||
    (patch.disease !== undefined && patch.disease !== before.disease) ||
    (patch.replaced !== undefined && patch.replaced !== before.replaced)
  );
}

/**
 * 放行后快照比对：构件当前关键信息与放行时不同 → 放行失效重算。
 * 返回 true 表示该批次应被作废。
 */
export function releaseStale(
  batch: FumigationBatch,
  components: Component[],
): boolean {
  if (batch.status !== "released" || !batch.releasedSnapshots) return false;
  const byId = new Map(components.map((c) => [c.id, c]));
  return batch.componentIds.some((id) => {
    const c = byId.get(id);
    const snap = batch.releasedSnapshots![id];
    if (!c || !snap) return false;
    return snapshotKey(snapshotOf(c)) !== snapshotKey(snap);
  });
}

/* -------------------------------- 构件状态派生 ------------------------------- */

export type ComponentPhase =
  | "untreated" // 未熏蒸
  | "fumigating" // 熏蒸密闭中
  | "await-recheck" // 待首次复检
  | "await-second" // 待第二次复检
  | "released" // 已复位放行
  | "recalculate" // 原批拒/废，需重算重熏
  | "rejected"; // 最近一次登记被整批拒绝

export function phaseOf(
  componentId: string,
  batches: FumigationBatch[],
  now: number,
): ComponentPhase {
  const mine = batches
    .filter((b) => b.componentIds.includes(componentId))
    .sort((a, b) => b.seq - a.seq);
  if (mine.length === 0) return "untreated";
  const latest = mine[0];

  switch (latest.status) {
    case "rejected":
      return "rejected";
    case "invalidated":
      return "recalculate";
    case "released":
      return "released";
    case "fumigating": {
      if (latest.rechecks.length === 0) {
        return now >= nextRecheckEarliest(latest)!
          ? "await-recheck"
          : "fumigating";
      }
      if (latest.rechecks.length === 1) {
        return now >= nextRecheckEarliest(latest)!
          ? "await-second"
          : "fumigating";
      }
      return "released";
    }
  }
}

export const PHASE_LABEL: Record<ComponentPhase, string> = {
  untreated: "未熏蒸",
  fumigating: "熏蒸密闭中",
  "await-recheck": "待首次复检",
  "await-second": "待第二次复检",
  released: "已复位放行",
  recalculate: "放行失效·重算",
  rejected: "登记被拒",
};

/* --------------------------------- 时间格式化 -------------------------------- */

const pad = (n: number) => String(n).padStart(2, "0");

export function toLocalInputValue(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours(),
  )}:${pad(d.getMinutes())}`;
}

export function dateInputValue(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function parseLocalInput(value: string): number {
  return new Date(value).getTime();
}

export function formatDateTime(ts: number): string {
  if (!ts) return "—";
  const d = new Date(ts);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(
    d.getHours(),
  )}:${pad(d.getMinutes())}`;
}

export function formatCountdown(ms: number): string {
  if (ms <= 0) return "已满 24 小时";
  const h = Math.floor(ms / HOUR);
  const m = Math.floor((ms % HOUR) / 60000);
  return `还需 ${h}小时${pad(m)}分`;
}
