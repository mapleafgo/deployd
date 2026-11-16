// 当前 UI、Mantine/hooks 与已装依赖没有 Go duration 校验能力。
// 依据 Go src/time/format.go 的 ParseDuration、leadingInt、leadingFraction；
// 保持完整单位/语法、逐段纳秒截断、float64 小数运算及 int64 溢出规则。
// 仅供任务输入校验，不格式化或重写原值；服务端仍是最终权威。
const units: Record<string, bigint> = {
  ns: 1n,
  us: 1000n,
  µs: 1000n,
  μs: 1000n,
  ms: 1000000n,
  s: 1000000000n,
  m: 60000000000n,
  h: 3600000000000n,
};
const limit = 1n << 63n;

export function parseGoDurationNanoseconds(input: string): bigint | null {
  const negative = input.startsWith("-");
  let rest = /^[+-]/.test(input) ? input.slice(1) : input;
  if (rest === "0") return 0n;
  if (!rest) return null;
  let total = 0n;
  while (rest) {
    const part = /^(\d*)(?:\.(\d*))?([^\d.]+)/.exec(rest);
    if (!part || (!part[1] && !part[2])) return null;
    const unitName = part[3];
    if (unitName === undefined || !Object.hasOwn(units, unitName)) return null;
    const unit = units[unitName];
    if (unit === undefined) return null;
    const integer = BigInt(part[1] || "0");
    if (integer > limit / unit) return null;
    let value = integer * unit;
    let fraction = 0n;
    let scale = 1;
    // Go 超过 uint63 精度后仍消费所有小数位，但不再累积数值或 scale。
    for (const digit of part[2] ?? "") {
      if (fraction > (limit - 1n) / 10n) break;
      const next = fraction * 10n + BigInt(digit);
      if (next > limit) break;
      fraction = next;
      scale *= 10;
    }
    if (fraction > 0n) {
      value += BigInt(Math.trunc(Number(fraction) * (Number(unit) / scale)));
      // Go 在小数非零分支检查单段，再按 uint64 累加；不能用无界整数替代。
      if (value > limit) return null;
    }
    // 对齐当前 Go 的 d += v uint64 回绕，再检查累计值，不排除 API 已接受原值。
    total = BigInt.asUintN(64, total + value);
    if (total > limit) return null;
    rest = rest.slice(part[0].length);
  }
  if (!negative && total === limit) return null;
  return negative ? -total : total;
}

export function isTaskTimeout(input: string): boolean {
  const duration = parseGoDurationNanoseconds(input);
  return duration !== null && duration >= 1000000000n && duration <= 86400000000000n;
}
