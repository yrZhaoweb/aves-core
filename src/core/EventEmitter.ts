/**
 * EventEmitter base class
 * Provides event handling functionality for aves-core components
 */
export class EventEmitter {
  private events: Map<string, Set<Function>>;

  constructor() {
    this.events = new Map();
  }

  /**
   * Register an event listener
   * @param event - Event name
   * @param callback - Callback function to be invoked when event is emitted
   * @returns this for chaining
   */
  on(event: string, callback: Function): this {
    if (!this.events.has(event)) {
      this.events.set(event, new Set());
    }
    this.events.get(event)!.add(callback);
    return this;
  }

  /**
   * Remove an event listener
   * @param event - Event name
   * @param callback - Callback function to remove
   * @returns this for chaining
   */
  off(event: string, callback: Function): this {
    const callbacks = this.events.get(event);
    if (callbacks) {
      callbacks.delete(callback);
      if (callbacks.size === 0) {
        this.events.delete(event);
      }
    }
    return this;
  }

  /**
   * Register a one-time event listener
   * @param event - Event name
   * @param callback - Callback function to be invoked once when event is emitted
   * @returns this for chaining
   */
  once(event: string, callback: Function): this {
    const onceWrapper = (...args: any[]) => {
      this.off(event, onceWrapper);
      callback(...args);
    };
    return this.on(event, onceWrapper);
  }

  /**
   * Emit an event with arguments
   * @param event - Event name
   * @param args - Arguments to pass to listeners
   */
  emit(event: string, ...args: any[]): void {
    const callbacks = this.events.get(event);
    if (callbacks) {
      // Create array from Set to preserve order and avoid modification during iteration
      const callbackArray = Array.from(callbacks);
      for (const callback of callbackArray) {
        callback(...args);
      }
    }
  }

  /**
   * Remove all listeners for a specific event or all events
   * @param event - Optional event name. If not provided, removes all listeners for all events
   */
  removeAllListeners(event?: string): void {
    if (event) {
      this.events.delete(event);
    } else {
      this.events.clear();
    }
  }
}
