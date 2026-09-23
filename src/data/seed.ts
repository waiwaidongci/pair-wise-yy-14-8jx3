/** 演示种子数据：构件测绘台账、药剂台账与初始批次账。 */
import {
  emptyLedger,
  recordRecheck,
  registerBatch,
  releaseBatch,
} from "../business/batchLedger";
import type { Chemical, Ledger, SurveyComponent } from "../business/types";

const DAY = 24 * 60 * 60 * 1000;

export function seedComponents(): SurveyComponent[] {
  const rows: Array<Omit<SurveyComponent, "revision" | "partReplaced">> = [
    {
      id: "c-a03",
      building: "文昌阁",
      code: "梁架A-03",
      wood: "楠木",
      jointType: "透榫",
      section: "180×240mm",
      disease: "端部开裂、蛀孔密集",
      deformation: "轻微下挠",
      suggestion: "熏蒸灭虫后嵌补",
    },
    {
      id: "c-c12",
      building: "文昌阁",
      code: "柱网C-12",
      wood: "楠木",
      jointType: "箍头榫",
      section: "Φ260mm",
      disease: "柱脚糟朽、白蚁蛀道",
      deformation: "倾斜2°",
      suggestion: "局部墩接",
    },
    {
      id: "c-a06",
      building: "文昌阁",
      code: "梁架A-06",
      wood: "楠木",
      jointType: "燕尾榫",
      section: "160×220mm",
      disease: "疑似蚁路",
      deformation: "无",
      suggestion: "纳入下批熏蒸",
    },
    {
      id: "c-d07",
      building: "大悲殿",
      code: "斗拱D-07",
      wood: "杉木",
      jointType: "半榫",
      section: "120×180mm",
      disease: "轻微虫蛀",
      deformation: "轻微变形",
      suggestion: "继续监测",
    },
    {
      id: "c-b05",
      building: "大悲殿",
      code: "枋木B-05",
      wood: "杉木",
      jointType: "燕尾榫",
      section: "140×200mm",
      disease: "蛀屑堆积",
      deformation: "无",
      suggestion: "熏蒸后复检",
    },
    {
      id: "c-d09",
      building: "大悲殿",
      code: "斗拱D-09",
      wood: "杉木",
      jointType: "半榫",
      section: "120×180mm",
      disease: "糟朽边缘",
      deformation: "轻微变形",
      suggestion: "换件备选",
    },
    {
      id: "c-e02",
      building: "山门",
      code: "檩条E-02",
      wood: "松木",
      jointType: "透榫",
      section: "Φ200mm",
      disease: "表面蛀孔",
      deformation: "无",
      suggestion: "登记观察",
    },
  ];
  return rows.map((r) => ({ ...r, partReplaced: false, revision: 0 }));
}

export function seedChemicals(now: number): Chemical[] {
  return [
    { batchNo: "YX-2026-0315", name: "硫酰氟", expiresAt: now + 180 * DAY },
    { batchNo: "YX-2026-0610", name: "磷化铝", expiresAt: now + 300 * DAY },
    { batchNo: "YX-2025-0901", name: "溴甲烷", expiresAt: now - 30 * DAY }, // 已过期，演示整批拒绝
  ];
}

/** 初始批次账：一笔已放行历史批 + 一笔处理期间的在熏批 */
export function seedLedger(
  now: number,
  components: SurveyComponent[],
  chemicals: Chemical[],
): Ledger {
  let ledger = emptyLedger;

  const done = registerBatch(
    ledger,
    {
      tentId: "仓罩T-02",
      componentIds: ["c-d07"],
      chemicalBatchNo: chemicals[0].batchNo,
      concentration: 10,
      pressure: 45,
      applicator: "张岚",
    },
    chemicals,
    components,
    now - 4 * DAY,
  );
  ledger = done.ledger;
  ledger = recordRecheck(
    ledger,
    done.batch.id,
    { inspector: "李慎", frassNew: false, residual: 1.8 },
    now - 3 * DAY,
  ).ledger;
  ledger = recordRecheck(
    ledger,
    done.batch.id,
    { inspector: "李慎", frassNew: false, residual: 0.3 },
    now - 2 * DAY,
  ).ledger;
  ledger = releaseBatch(ledger, done.batch.id, now - 2 * DAY + 3_600_000).ledger;

  const active = registerBatch(
    ledger,
    {
      tentId: "仓罩T-01",
      componentIds: ["c-a03", "c-c12"],
      chemicalBatchNo: chemicals[0].batchNo,
      concentration: 12,
      pressure: 42,
      applicator: "张岚",
    },
    chemicals,
    components,
    now - 6 * 3_600_000,
  );
  ledger = active.ledger;

  return ledger;
}
