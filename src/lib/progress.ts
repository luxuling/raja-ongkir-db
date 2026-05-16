const BAR_WIDTH = 28;

/** Cursor up one line, to start of line, clear to EOL, then down (keeps cursor on a line below the bar). */
const REDRAW = "\x1b[1A\r\x1b[0K";

function bar(ratio: number): string {
  const filled = Math.round(BAR_WIDTH * Math.min(1, Math.max(0, ratio)));
  return "█".repeat(filled) + "░".repeat(BAR_WIDTH - filled);
}

function pct(current: number, total: number): number {
  if (total <= 0) return 100;
  return Math.round((current / total) * 100);
}

export function truncate(text: string, max = 40): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1)}…`;
}

export class PhaseProgress {
  /** Progress line is drawn; cursor sits on the empty line below it. */
  private ttyLane = false;

  constructor(
    private readonly phase: string,
    private readonly total: number,
  ) {
    if (total > 0) {
      console.log(`\n▸ ${phase} — ${total} items`);
    } else {
      console.log(`\n▸ ${phase} (nothing to fetch)`);
    }
  }

  private formatLine(current: number, detail: string, extra?: string): string {
    const ratio = current / this.total;
    const suffix = extra ? ` · ${extra}` : "";
    const line = `  [${bar(ratio)}] ${pct(current, this.total)}% (${current}/${this.total}) ${detail}${suffix}`;
    const width = process.stdout.columns ?? 100;
    return line.slice(0, Math.max(20, width - 1));
  }

  tick(current: number, detail: string, extra?: string) {
    if (this.total <= 0) return;

    const line = this.formatLine(current, detail, extra);

    if (process.stdout.isTTY) {
      if (!this.ttyLane) {
        process.stdout.write(`${line}\n`);
        this.ttyLane = true;
      } else {
        process.stdout.write(`${REDRAW}${line}\n`);
      }
      return;
    }

    if (current === 1 || current === this.total || current % 50 === 0) {
      console.log(line);
    }
  }

  done(summary: string) {
    if (process.stdout.isTTY && this.ttyLane) {
      // Leave the last progress line visible; cursor is already on the line below it.
    }
    console.log(`  ✓ ${summary}`);
  }
}

export function logPhaseHeader(step: number, totalSteps: number, title: string) {
  console.log(`\n━━ Step ${step}/${totalSteps}: ${title} ━━`);
}
