import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { parseGoDurationNanoseconds, isTaskTimeout } from "../frontend/duration";

describe("Go time.ParseDuration 与任务范围", () => {
  it("与当前 Go 标准库对完整语法、长小数及溢出做差分", () => {
    const inputs = [
      "0",
      "+0",
      "-0",
      "",
      "1s-1s",
      "1__proto__",
      "1constructor",
      "24h1ns",
      "2562047h47m16.854775807s",
      "-2562047h47m16.854775808s",
      "2562047h47m16.854775808s",
      "9223372036854775808ns9223372036854775808.999999999999999999999ns1s",
      "9223372036854775808ns9223372036854775807.999999999999999999999ns1s",
      "-9223372036854775808ns9223372036854775808.999999999999999999999ns1s",
    ];
    for (const sign of ["", "+", "-"]) {
      for (const segment of [
        "9223372036854775808ns",
        "9223372036854775808.0ns",
        "9223372036854775808.1ns",
        "9223372036854775808.999999999999999999999ns",
        "9223372036854775807.999999999999999999999ns",
        "9223372036854775807.1ns",
      ]) {
        for (const tail of ["", "1s", "24h", "24h1ns", "999999999ns"]) {
          inputs.push(`${sign}${segment}${segment}${tail}`);
        }
      }
    }
    for (const sign of ["", "+", "-"]) {
      for (const number of [
        "0",
        "1",
        "1.",
        ".5",
        ".",
        "00.25",
        "0.999999999999999999999999999999999999",
        "9223372036854775808",
        "9223372036854775809",
        "1.00000000099999999999999999999",
      ]) {
        for (const unit of ["ns", "us", "µs", "μs", "ms", "s", "m", "h", "d", ""]) {
          inputs.push(`${sign}${number}${unit}`, `${sign}${number}${unit}1m1s`);
        }
      }
    }
    const expected: (string | null)[] = JSON.parse(
      execFileSync("go", ["run", "tasks/tests/duration-oracle.go"], {
        input: JSON.stringify(inputs),
        encoding: "utf8",
      }),
    );
    inputs.forEach((input, index) => {
      const actual = parseGoDurationNanoseconds(input);
      expect(actual === null ? null : actual.toString(), input).toBe(expected[index]);
      const oracle = expected[index];
      expect(oracle, "oracle 结果必须与输入一一对应").not.toBeUndefined();
      const duration = oracle === null || oracle === undefined ? null : BigInt(oracle);
      expect(isTaskTimeout(input), input).toBe(
        duration !== null && duration >= 1000000000n && duration <= 86400000000000n,
      );
    });
  });
  it.each([
    ["9223372036854775808ns9223372036854775808ns1s", 1000000000n],
    ["+9223372036854775808ns9223372036854775808ns24h", 86400000000000n],
    ["-9223372036854775808ns9223372036854775808ns1s", -1000000000n],
    ["9223372036854775808ns9223372036854775808ns", 0n],
    [".5h", 1800000000000n],
    ["+30m", 1800000000000n],
    ["1000000us", 1000000000n],
    ["1000000µs", 1000000000n],
    ["1000000μs", 1000000000n],
    ["1000000000ns", 1000000000n],
    ["1.s", 1000000000n],
    ["1h2m3.004005006s", 3723004005006n],
    ["1s1s", 2000000000n],
    ["1m1h", 3660000000000n],
    ["-.5s", -500000000n],
    ["-0", 0n],
    ["+0", 0n],
    ["0", 0n],
    ["0.0000000009s", 0n],
    ["1.000000000999999999999999999s", 1000000001n],
    ["2562047h47m16.854775807s", 9223372036854775807n],
    ["-2562047h47m16.854775808s", -9223372036854775808n],
  ] as const)("解析合法完整语法 %s", (value, expected) => {
    expect(parseGoDurationNanoseconds(value)).toBe(expected);
  });
  it.each([
    "",
    "+",
    "-",
    ".s",
    "1",
    "1d",
    "1e3s",
    " 1s",
    "1s ",
    "1s-1s",
    "1s+1s",
    "1..0s",
    "1S",
    "1_000s",
    "2562047h47m16.854775808s",
    "-2562047h47m16.854775809s",
    "9223372036854775809ns",
    "999999999999999999999999h",
  ])("拒绝非法或溢出 %s", (value) => {
    expect(parseGoDurationNanoseconds(value)).toBeNull();
  });
  it.each(["1s", "+1s", ".5h", "1.s", "1000000us", "24h", "86400s", "24h0.0000000009s"])(
    "范围内接受且不规范化 %s",
    (value) => {
      expect(isTaskTimeout(value)).toBe(true);
    },
  );
  it.each(["0", "-0", "-1s", "999999999ns", "24h1ns", "0.5s", "25h", "invalid"])(
    "拒绝范围外或错误 %s",
    (value) => {
      expect(isTaskTimeout(value)).toBe(false);
    },
  );
});
