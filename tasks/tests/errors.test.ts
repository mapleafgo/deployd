import { expect, it } from "vitest";
import { safeFailure, failureText, submitErrors } from "../frontend/errors";

it("字段聚合保留稳定纠正原因；未知位置与变量错误保留操作级且不显示服务端秘密", () => {
  const result = submitErrors(
    {
      status: 422,
      info: {
        errors: [
          { location: "body.workdir", code: "absoluteWorkdir", message: "secret" },
          { location: "body.workdir", code: "noNul" },
          { location: "body.timeout", code: "timeoutRange" },
          { location: "body.env.KEY", code: "envName" },
          { location: "body.steps[0].env.KEY", code: "noNul" },
          { location: "body.unknown", code: "secret" },
        ],
      },
    },
    ["step"],
    ["step"],
  );
  expect(result.fields.workdir).toEqual(["validation.absoluteWorkdir", "validation.noNul"]);
  expect(result.fields.timeout).toEqual(["validation.timeoutRange"]);
  expect(result.fields.env).toEqual(["validation.envName"]);
  expect(result.fields["steps[0].env"]).toEqual(["validation.noNul"]);
  expect(result.form).toEqual(["invalidInput"]);
  expect(JSON.stringify(result)).not.toContain("secret");
});
it("错误仅展示安全文案和requestId，不泄漏异常", () => {
  const value = safeFailure({ status: 500, requestId: "req-123", message: "secret" });
  expect(failureText(value, (key) => key)).toBe("requestFailed · req-123");
  expect(JSON.stringify(value)).not.toContain("secret");
});
it("保留标准Chi斜线请求编号与旧编号，拒绝过长、控制字符和HTML", () => {
  for (const requestId of ["cachyos-pan/qrm7d8FfGH-000001", "req-123", "a".repeat(128)]) {
    expect(safeFailure({ status: 500, requestId }).requestId).toBe(requestId);
    expect(failureText(safeFailure({ status: 500, requestId }), (key) => key)).toContain(requestId);
    expect(safeFailure(new Error("streamFailed"), requestId).requestId).toBe(requestId);
  }
  for (const requestId of [
    "",
    "a".repeat(129),
    "id\n",
    "id\r\n",
    "id\t",
    "id\u0000",
    "id\u007f",
    "<script>alert(1)</script>",
    "id value",
  ]) {
    expect(safeFailure({ status: 500, requestId }).requestId).toBeUndefined();
    expect(safeFailure(new Error("streamFailed"), requestId).requestId).toBeUndefined();
  }
});

it("结构化字段错误按当前步骤身份映射，删除步骤不串位，未知位置留表单级", () => {
  const result = submitErrors(
    {
      info: {
        errors: [
          { location: "body.steps[0].name", message: "secret" },
          { location: "body.steps[1].commands" },
          { location: "body.description" },
          { location: "body.unknown" },
        ],
      },
    },
    ["a", "b"],
    ["b"],
  );
  expect(result.fields).toEqual({
    "steps[0].script": ["invalidInput"],
    description: ["invalidInput"],
  });
  expect(result.form).toEqual(["invalidInput"]);
});
