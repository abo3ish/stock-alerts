// Small colored logger on Node's own util.styleText: no dependency. Pure formatting helpers + console output.
import { styleText } from 'node:util';

// Color only on a terminal, so logs written to a file or grepped stay plain. NO_COLOR / FORCE_COLOR override.
const useColor = !process.env.NO_COLOR && (!!process.env.FORCE_COLOR || !!process.stdout.isTTY);

export const paint = (format: string, text: string | number): string =>
  useColor ? styleText(format as Parameters<typeof styleText>[0], String(text)) : String(text);

export const sep = paint('gray', '│');
export const num = (n: number) => n.toLocaleString('en-US');

export const duration = (ms: number): string =>
  ms < 1000 ? `${Math.round(ms)}ms`
  : ms < 60_000 ? `${(ms / 1000).toFixed(1)}s`
  : ms < 3_600_000 ? `${(ms / 60_000).toFixed(1)}m`
  : `${(ms / 3_600_000).toFixed(1)}h`;

// Traffic light for a metric: green below warnAt, yellow below badAt, red from badAt.
export const health = (value: number, warnAt: number, badAt: number) =>
  value >= badAt ? 'red' : value >= warnAt ? 'yellow' : 'green';

export type Logger = ReturnType<typeof createLogger>;

export function createLogger(name: string, color: string) {
  const tag = paint('bold', paint(color, name.padEnd(9)));
  const line = (msg: string) => `${paint('gray', new Date().toTimeString().slice(0, 8))}  ${tag}  ${msg}`;
  return Object.freeze({
    info: (msg: string) => console.log(line(msg)),
    warn: (msg: string) => console.log(line(paint('yellow', msg))),
    error: (msg: string) => console.error(line(paint('red', msg))),
  });
}
