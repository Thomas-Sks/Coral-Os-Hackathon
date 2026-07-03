/**
 * Structured logging with a per-deal correlation id.
 *
 * Every log line is a single JSON object carrying the `correlationId` that threads a deal from WANT
 * through settlement, so a run can be reconstructed from stdout. Two moments are named events, not
 * free text, because the demo narrative leads with them:
 *   - `decision-to-pay`  — the instant the buyer evaluates the delivered report and elects to RELEASE
 *   - `authorization`    — the consent verdict that gates the whole flow
 *
 * No I/O beyond `console`; browser-safe.
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

/** A first-class, greppable event name. `decision-to-pay` is the money moment. */
export type NamedEvent =
  | 'want'
  | 'bid'
  | 'award'
  | 'authorization'
  | 'deposited'
  | 'delivery-progress'
  | 'delivered'
  | 'decision-to-pay'
  | 'released'
  | 'refunded'
  | 'rejected'

export interface LogFields {
  [key: string]: unknown
}

export interface Logger {
  readonly correlationId: string
  debug(msg: string, fields?: LogFields): void
  info(msg: string, fields?: LogFields): void
  warn(msg: string, fields?: LogFields): void
  error(msg: string, fields?: LogFields): void
  /** Emit a named lifecycle event (defaults to info). */
  event(name: NamedEvent, fields?: LogFields, level?: LogLevel): void
  /** Derive a child logger that keeps the correlation id and merges extra base fields. */
  child(fields: LogFields): Logger
}

const LEVEL_WEIGHT: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 }

export interface LoggerOptions {
  /** Minimum level to emit. Defaults to `info`. */
  level?: LogLevel
  /** Component tag, e.g. 'seller:tls-specialist' or 'buyer'. */
  component?: string
  /** Injected time source — callers pass one so logging is deterministic in tests. */
  now?: () => string
  /** Injected sink for tests; defaults to console. */
  sink?: (level: LogLevel, line: string) => void
}

function defaultSink(level: LogLevel, line: string): void {
  /* eslint-disable no-console */
  const fn = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log
  /* eslint-enable no-console */
  fn(line)
}

/**
 * Create a correlation-scoped logger. `correlationId` should be stable for the lifetime of one deal
 * (the buyer mints it; the seller echoes it into the report). All lines are single-line JSON.
 */
export function createLogger(correlationId: string, opts: LoggerOptions = {}): Logger {
  const componentBase: LogFields = opts.component ? { component: opts.component } : {}
  return makeLogger(correlationId, opts, componentBase)
}

function makeLogger(correlationId: string, opts: LoggerOptions, base: LogFields): Logger {
  const minWeight = LEVEL_WEIGHT[opts.level ?? 'info']
  const now = opts.now ?? (() => new Date().toISOString())
  const sink = opts.sink ?? defaultSink

  const emit = (level: LogLevel, msg: string, fields?: LogFields, event?: NamedEvent): void => {
    if (LEVEL_WEIGHT[level] < minWeight) return
    const record = {
      t: now(),
      level,
      correlationId,
      ...(event ? { event } : {}),
      msg,
      ...base,
      ...(fields ?? {}),
    }
    sink(level, JSON.stringify(record))
  }

  return {
    correlationId,
    debug: (msg, fields) => emit('debug', msg, fields),
    info: (msg, fields) => emit('info', msg, fields),
    warn: (msg, fields) => emit('warn', msg, fields),
    error: (msg, fields) => emit('error', msg, fields),
    event: (name, fields, level = 'info') => emit(level, `event:${name}`, fields, name),
    child: (fields) => makeLogger(correlationId, opts, { ...base, ...fields }),
  }
}
