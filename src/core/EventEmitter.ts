/**
 * EventEmitter base class with optional type-safe event maps.
 *
 * When no type parameter is supplied the emitter is untyped (backward-compatible).
 * Supply an event map to get full type safety on `on`, `emit`, and `off`:
 *
 * ```ts
 * interface MyEvents {
 *   data: [payload: string, count: number];
 *   close: [];
 * }
 * const emitter = new EventEmitter<MyEvents>();
 * emitter.on("data", (payload, count) => { ... });  // payload: string, count: number
 * emitter.emit("data", "hello", 42);                 // type-safe args
 * ```
 */
type EventArgs<TEvents, TEvent extends keyof TEvents> =
  TEvents[TEvent] extends unknown[] ? TEvents[TEvent] : never;

export class EventEmitter<
  TEvents extends object = Record<string, unknown[]>,
> {
  // Use an internal untyped store; type safety is enforced at the public API boundary.
  private events: Map<string, Set<(...args: unknown[]) => void>>;

  constructor() {
    this.events = new Map();
  }

  /**
   * Register an event listener.
   */
  on<E extends keyof TEvents & string>(
    event: E,
    callback: (...args: EventArgs<TEvents, E>) => void,
  ): this {
    if (!this.events.has(event)) {
      this.events.set(
        event,
        new Set<(...args: unknown[]) => void>(),
      );
    }
    this.events.get(event)!.add(callback as (...args: unknown[]) => void);
    return this;
  }

  /**
   * Remove an event listener.
   */
  off<E extends keyof TEvents & string>(
    event: E,
    callback: (...args: EventArgs<TEvents, E>) => void,
  ): this {
    const callbacks = this.events.get(event);
    if (callbacks) {
      callbacks.delete(callback as (...args: unknown[]) => void);
      if (callbacks.size === 0) {
        this.events.delete(event);
      }
    }
    return this;
  }

  /**
   * Register a one-time event listener.
   */
  once<E extends keyof TEvents & string>(
    event: E,
    callback: (...args: EventArgs<TEvents, E>) => void,
  ): this {
    const onceWrapper = (...args: unknown[]) => {
      this.off(event, onceWrapper);
      (callback as (...args: unknown[]) => void)(...args);
    };
    if (!this.events.has(event)) {
      this.events.set(event, new Set([onceWrapper]));
    } else {
      this.events.get(event)!.add(onceWrapper);
    }
    return this;
  }

  /**
   * Emit an event with typed arguments.
   */
  emit<E extends keyof TEvents & string>(
    event: E,
    ...args: EventArgs<TEvents, E>
  ): void {
    const callbacks = this.events.get(event);
    if (callbacks) {
      const callbackArray = Array.from(callbacks);
      for (const callback of callbackArray) {
        callback(...args);
      }
    }
  }

  /**
   * Remove all listeners for a specific event or all events.
   */
  removeAllListeners(event?: string): void {
    if (event) {
      this.events.delete(event);
    } else {
      this.events.clear();
    }
  }
}
