/**
 * 业务文件一：判定。
 * 熏蒸登记、复检、放行、失效的纯判定逻辑，不持有状态，供批次账调用。
 */
import type { Chemical, FumigationBatch } from "./types";

/** 仓压下限 Pa，不足则整批拒绝 */
export const MIN_TENT_PRESSURE_PA = 30;
/** 残留浓度安全线 g/m³，回落到此值以下才可复位 */
export const SAFE_RESIDUAL_G_M3 = 0.5;
/** 两次复检的最小间隔：二十四小时 */
export const RECHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
/** 放行前必须完成的复检次数 */
export const REQUIRED_RECHECKS = 2;

export interface RegistrationInput {
  tentId: string; // 仓罩编号
  componentIds: string[]; // 入仓构件
  chemicalBatchNo: string; // 药剂批次
  concentration: number; // 施药浓度 g/m³
  pressure: number; // 仓压 Pa
  applicator: string; // 施药人
}

export type Decision = { ok: true } | { ok: false; reason: string };

const pass: Decision = { ok: true };
const fail = (reason: string): Decision => ({ ok: false, reason });

/** 登记判定：药剂过期或仓压不足时整批拒绝 */
export function judgeRegistration(
  input: RegistrationInput,
  chemicals: Chemical[],
  now: number,
): Decision {
  if (!input.tentId.trim()) return fail("仓罩编号不能为空");
  if (input.componentIds.length === 0) return fail("批次至少登记一件构件");
  if (!input.applicator.trim()) return fail("施药人不能为空");
  const chemical = chemicals.find((c) => c.batchNo === input.chemicalBatchNo);
  if (!chemical) return fail("药剂批次未登记在册");
  if (chemical.expiresAt < now) {
    return fail(`药剂「${chemical.name}」批次 ${chemical.batchNo} 已过期，整批拒绝`);
  }
  if (!(input.pressure >= MIN_TENT_PRESSURE_PA)) {
    return fail(`仓压 ${input.pressure}Pa 低于 ${MIN_TENT_PRESSURE_PA}Pa，整批拒绝`);
  }
  if (!(input.concentration > 0)) return fail("施药浓度须大于 0 g/m³");
  return pass;
}

/** 复检判定：须由非施药人执行，两次复检间隔满二十四小时 */
export function judgeRecheck(
  batch: FumigationBatch,
  inspector: string,
  at: number,
): Decision {
  if (batch.readonly || batch.status !== "active") {
    return fail("旧批只读，不能再登记复检");
  }
  const who = inspector.trim();
  if (!who) return fail("复检人不能为空");
  if (who === batch.applicator.trim()) {
    return fail("复检人不得与施药人为同一人");
  }
  if (batch.rechecks.length >= REQUIRED_RECHECKS) {
    return fail(`${REQUIRED_RECHECKS} 次复检已完成，等待放行判定`);
  }
  const prev = batch.rechecks[batch.rechecks.length - 1];
  if (prev && at - prev.at < RECHECK_INTERVAL_MS) {
    return fail("两次复检须间隔满二十四小时");
  }
  return pass;
}

/** 放行判定：两次复检合格、蛀屑无新增且浓度回落才可复位 */
export function judgeRelease(batch: FumigationBatch): Decision {
  if (batch.readonly || batch.status !== "active") {
    return fail("旧批只读，不能放行");
  }
  if (batch.rechecks.length < REQUIRED_RECHECKS) {
    return fail(`需完成 ${REQUIRED_RECHECKS} 次复检`);
  }
  if (batch.rechecks.some((r) => r.frassNew)) {
    return fail("蛀屑仍有新增，禁止复位");
  }
  const latest = batch.rechecks[batch.rechecks.length - 1];
  if (latest.residual > SAFE_RESIDUAL_G_M3) {
    return fail(
      `残留浓度 ${latest.residual}g/m³ 未回落至 ${SAFE_RESIDUAL_G_M3}g/m³ 以下`,
    );
  }
  return pass;
}

/**
 * 失效判定：处理期间（熏蒸中）或已放行的批次，
 * 构件尺寸 / 病害 / 换件一变，原放行即失效重算；拒绝与已失效的旧批本就只读。
 */
export function judgeInvalidation(batch: FumigationBatch): boolean {
  return batch.status === "active" || batch.status === "released";
}
