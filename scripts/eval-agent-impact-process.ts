import { spawn } from "node:child_process";
import { performance } from "node:perf_hooks";
import { StringDecoder } from "node:string_decoder";

export interface ObservedToolTiming {
  itemId: string;
  command: string;
  observedStartMs: number | null;
  observedEndMs: number | null;
  observedDurationMs: number | null;
}

export interface ObservedProcessResult {
  status: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  error?: string;
  toolTimings: ObservedToolTiming[];
}

export interface ObservedProcessOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  input?: string;
  timeoutMs: number;
  /** Combined stdout/stderr byte limit. Overflow retains the prefix and fails the run. */
  maxBuffer: number;
}

/** Times JSONL reception, not CLI execution: buffered events can arrive together. */
export function runObservedCodexProcess(file: string, args: string[], options: ObservedProcessOptions): Promise<ObservedProcessResult> {
  if (!Number.isSafeInteger(options.timeoutMs) || options.timeoutMs <= 0
    || !Number.isSafeInteger(options.maxBuffer) || options.maxBuffer <= 0) {
    throw new Error("timeoutMs and maxBuffer must be positive safe integers");
  }
  return new Promise((resolve) => {
    const started = performance.now();
    const result: ObservedProcessResult = { status: null, stdout: "", stderr: "", timedOut: false, toolTimings: [] };
    const timings = new Map<string, ObservedToolTiming>();
    const decoder = { stdout: new StringDecoder("utf8"), stderr: new StringDecoder("utf8") };
    let pending = "";
    let bytes = 0;
    let stopped = false;
    let spawnFailed = false;
    let lastStdoutMs = 0;
    const group = process.platform === "linux";
    const child = spawn(file, args, { cwd: options.cwd, env: options.env, detached: group, stdio: ["pipe", "pipe", "pipe"] });
    const stop = () => {
      if (stopped) return;
      stopped = true;
      try {
        if (group && child.pid) process.kill(-child.pid, "SIGKILL");
        else child.kill("SIGKILL");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ESRCH") result.error ??= "Process termination failed";
      }
    };
    const timer = setTimeout(() => {
      result.timedOut = true;
      result.error ??= "Process timed out";
      stop();
    }, options.timeoutMs);

    const event = (line: string, elapsed: number) => {
      let value: any;
      try { value = JSON.parse(line); } catch { return; }
      if (!value || (value.type !== "item.started" && value.type !== "item.completed")
        || value.item?.type !== "command_execution" || typeof value.item.id !== "string") return;
      let timing = timings.get(value.item.id);
      if (!timing) {
        timing = { itemId: value.item.id, command: typeof value.item.command === "string" ? value.item.command : "",
          observedStartMs: null, observedEndMs: null, observedDurationMs: null };
        timings.set(timing.itemId, timing);
        result.toolTimings.push(timing);
      }
      if (!timing.command && typeof value.item.command === "string") timing.command = value.item.command;
      if (value.type === "item.started") timing.observedStartMs ??= elapsed;
      else timing.observedEndMs ??= elapsed;
      if (timing.observedStartMs !== null && timing.observedEndMs !== null && timing.observedEndMs >= timing.observedStartMs) {
        timing.observedDurationMs = timing.observedEndMs - timing.observedStartMs;
      }
    };
    const receive = (stream: "stdout" | "stderr", chunk: Buffer) => {
      const elapsed = performance.now() - started;
      const available = Math.max(0, options.maxBuffer - bytes);
      const kept = chunk.subarray(0, available);
      bytes += kept.length;
      const value = decoder[stream].write(kept);
      result[stream] += value;
      if (stream === "stdout") {
        lastStdoutMs = elapsed;
        pending += value;
        let newline: number;
        while ((newline = pending.indexOf("\n")) >= 0) {
          event(pending.slice(0, newline), elapsed);
          pending = pending.slice(newline + 1);
        }
      }
      if (chunk.length > available) {
        result.error ??= "Process output exceeded maxBuffer; stdout/stderr are truncated";
        stop();
      }
    };
    child.stdout.on("data", (chunk: Buffer) => receive("stdout", chunk));
    child.stderr.on("data", (chunk: Buffer) => receive("stderr", chunk));
    child.on("error", (error: NodeJS.ErrnoException) => { spawnFailed = true; result.error ??= `Process spawn failed (${error.code ?? "unknown"})`; });
    // A child may exit before consuming its prompt; never turn EPIPE into an uncaught exception.
    child.stdin.on("error", (error: NodeJS.ErrnoException) => {
      if (error.code !== "EPIPE") { result.error ??= `Process input failed (${error.code ?? "unknown"})`; stop(); }
    });
    child.on("close", (status, signal) => {
      clearTimeout(timer);
      result.status = spawnFailed ? null : status;
      if (signal) result.error ??= `Process terminated (${signal})`;
      const tail = decoder.stdout.end();
      result.stdout += tail;
      result.stderr += decoder.stderr.end();
      pending += tail;
      // A complete JSON object without a final newline still counts; a partial object remains raw only.
      if (pending) event(pending, lastStdoutMs);
      resolve(result);
    });
    child.stdin.end(options.input);
  });
}
