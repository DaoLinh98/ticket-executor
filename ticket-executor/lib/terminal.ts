import { spawn } from "child_process";

/** Open an OS terminal in `rootRepo` with the Claude CLI already running in it.
 *
 *  Deliberately separate from `lib/execution/` — nothing here starts a `Run`,
 *  takes a worktree or touches admission. It is the button equivalent of the
 *  developer opening a terminal themselves, and the process it spawns outlives
 *  this one (`detached` + `unref`).
 *
 *  The repo path is never interpolated into a shell string: it is the child's
 *  `cwd`, or an argv element. A path holding `&`, `|` or `%` therefore cannot
 *  become a command. The one exception is macOS, whose only way to run a
 *  command in Terminal.app is AppleScript text — `unsafePath()` refuses the
 *  characters that would break out of its quoting.
 */
export type TerminalResult = { ok: boolean; error?: string };

type Candidate = { cmd: string; args: string[] };

function unsafePath(p: string): boolean {
  return /["'`$\n\r]/.test(p) || p.includes("\\");
}

function candidates(p: string): Candidate[] {
  if (process.platform === "win32")
    return [
      { cmd: "wt.exe", args: ["-d", p, "cmd", "/k", "claude"] },
      { cmd: "cmd.exe", args: ["/c", "start", "", "cmd", "/k", "claude"] },
    ];
  if (process.platform === "darwin")
    return [{ cmd: "osascript", args: ["-e", `tell application "Terminal" to do script "cd '${p}' && claude"`, "-e", 'tell application "Terminal" to activate'] }];
  return [
    { cmd: "x-terminal-emulator", args: ["-e", "claude"] },
    { cmd: "gnome-terminal", args: ["--", "claude"] },
    { cmd: "konsole", args: ["-e", "claude"] },
    { cmd: "xterm", args: ["-e", "claude"] },
  ];
}

function trySpawn(c: Candidate, cwd: string): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (ok: boolean) => {
      if (settled) return;
      settled = true;
      resolve(ok);
    };
    try {
      const child = spawn(c.cmd, c.args, { cwd, detached: true, stdio: "ignore" });
      child.on("error", () => finish(false));
      child.on("spawn", () => {
        child.unref();
        finish(true);
      });
    } catch {
      finish(false);
    }
  });
}

/** Caller validates the path first (`validateRootRepo`); this only launches. */
export async function openTerminalAt(rootRepo: string): Promise<TerminalResult> {
  const p = rootRepo.trim();
  if (process.platform === "darwin" && unsafePath(p))
    return { ok: false, error: `Cannot open a terminal at ${p}: the path contains a character macOS cannot be asked for safely.` };
  for (const c of candidates(p)) {
    if (await trySpawn(c, p)) return { ok: true };
  }
  return {
    ok: false,
    error: process.platform === "win32"
      ? "No terminal could be launched. Windows Terminal (wt.exe) and cmd.exe were both unavailable."
      : `No terminal emulator was found on this machine. Open one yourself and run: cd ${p} && claude`,
  };
}
