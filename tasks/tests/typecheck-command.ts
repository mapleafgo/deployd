import { execFileSync } from "node:child_process";

// 测试共用的真实编译进程闸门，不替换或模拟 tsc。
export function typecheckDiagnostics(command: string, args: string[]): string {
  try {
    execFileSync(command, args, { encoding: "utf8", stdio: "pipe" });
    return "";
  } catch (error) {
    const failure = error as { status?: number | null; stdout?: string; stderr?: string };
    // 非零退出、信号中断或启动失败一律留下非空失败；不能以 stdout 是否为空判成功。
    return `类型检查进程失败（status=${failure.status ?? "未正常退出"}）\n${String(error)}\nstdout:\n${failure.stdout ?? ""}\nstderr:\n${failure.stderr ?? ""}`;
  }
}
