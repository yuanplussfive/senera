export function applyTerminalSignal(terminal, signal, platform = process.platform) {
  if (signal === "interrupt") {
    if (platform === "win32") terminal.write("\u0003");
    else terminal.kill("SIGINT");
    return;
  }

  if (platform === "win32") {
    terminal.kill();
    return;
  }
  terminal.kill(signal === "kill" ? "SIGKILL" : "SIGTERM");
}
