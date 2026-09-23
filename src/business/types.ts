/** 共享领域类型：判定、批次账、界面状态三个业务文件共同引用。 */

export type BatchStatus =
  | "active" // 熏蒸隔离中（处理期间）
  | "released" // 已复位放行
  | "rejected" // 整批拒绝（药剂过期 / 仓压不足）
  | "invalidated"; // 已失效（构件变更，放行作废重算）

/** 榫卯构件测绘记录 */
export interface SurveyComponent {
  id: string;
  building: string; // 建筑名称
  code: string; // 构件编号
  wood: string; // 木材种类
  jointType: string; // 榫卯类型
  section: string; // 截面尺寸
  disease: string; // 病害位置
  deformation: string; // 变形情况
  suggestion: string; // 修缮建议
  partReplaced: boolean; // 是否换件
  revision: number; // 测绘版本：尺寸 / 病害 / 换件变更时 +1
}

/** 药剂批次台账 */
export interface Chemical {
  batchNo: string; // 药剂批次号
  name: string; // 药剂名称
  expiresAt: number; // 有效期至（时间戳）
}

/** 复检记录：熏蒸后由非施药人隔二十四小时复检两次 */
export interface Recheck {
  id: string;
  inspector: string; // 复检人（不得为施药人）
  at: number;
  frassNew: boolean; // 蛀屑是否有新增
  residual: number; // 残留浓度 g/m³
}

/** 熏蒸批次 */
export interface FumigationBatch {
  id: string;
  tentId: string; // 仓罩编号（同一仓罩仅接一批）
  componentIds: string[];
  chemicalBatchNo: string; // 药剂批次
  chemicalName: string;
  concentration: number; // 施药浓度 g/m³
  pressure: number; // 仓压 Pa
  applicator: string; // 施药人
  createdAt: number;
  status: BatchStatus;
  readonly: boolean; // 旧批只读
  note: string; // 拒绝 / 失效原因
  rechecks: Recheck[];
  releasedAt: number | null;
  /** 登记时各构件的测绘版本快照，用于失效重算追溯 */
  revisionSnapshot: Record<string, number>;
}

export type LedgerEventKind =
  | "register" // 登记入仓
  | "reuse" // 仓罩重复登记，沿用首次
  | "reject" // 整批拒绝
  | "recheck" // 复检入账
  | "release" // 复位放行
  | "invalidate"; // 放行失效重算

/** 批次账流水 */
export interface LedgerEvent {
  id: string;
  at: number;
  batchId: string;
  tentId: string;
  kind: LedgerEventKind;
  detail: string;
}

/** 批次账：批次 + 流水，只追加不篡改 */
export interface Ledger {
  batches: FumigationBatch[];
  events: LedgerEvent[];
}

/** 构件处理状态（由批次账派生，清单 / 隔离队列 / 关系图共用） */
export type ComponentStage = "待处理" | "隔离中" | "已放行" | "待重算";
