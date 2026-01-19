/**
 * Property-based tests for EventEmitter
 * Feature: webrtc-library-extraction, Property 2: 事件系统完整性
 *
 * **Validates: Requirements 14.1, 14.2, 14.3, 14.4, 14.5, 14.6**
 */

import * as fc from "fast-check";
import { EventEmitter } from "../../core/EventEmitter";

describe("EventEmitter Property Tests", () => {
  describe("Property 2: 事件系统完整性", () => {
    /**
     * Property: Listeners registered with 'on' should be called when event is emitted
     * Validates: Requirements 14.1, 14.2, 14.5
     */
    it("should call all listeners registered with on() when event is emitted", () => {
      fc.assert(
        fc.property(
          fc.string(), // event name
          fc.array(fc.integer()), // array of integers to pass as arguments
          fc.integer({ min: 1, max: 10 }), // number of listeners
          (eventName, args, listenerCount) => {
            const emitter = new EventEmitter();
            const callCounts: number[] = new Array(listenerCount).fill(0);

            // Register multiple listeners
            for (let i = 0; i < listenerCount; i++) {
              const index = i;
              emitter.on(eventName, () => {
                callCounts[index]++;
              });
            }

            // Emit the event
            emitter.emit(eventName, ...args);

            // All listeners should be called exactly once
            for (let i = 0; i < listenerCount; i++) {
              expect(callCounts[i]).toBe(1);
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    /**
     * Property: Listeners removed with 'off' should not be called when event is emitted
     * Validates: Requirements 14.3
     */
    it("should not call listeners removed with off()", () => {
      fc.assert(
        fc.property(
          fc.string(), // event name
          fc.integer({ min: 1, max: 10 }), // number of listeners to register
          fc.integer({ min: 0, max: 9 }), // index of listener to remove
          (eventName, listenerCount, removeIndex) => {
            // Ensure removeIndex is valid
            const validRemoveIndex = removeIndex % listenerCount;

            const emitter = new EventEmitter();
            const callCounts: number[] = new Array(listenerCount).fill(0);
            const listeners: Function[] = [];

            // Register multiple listeners
            for (let i = 0; i < listenerCount; i++) {
              const index = i;
              const listener = () => {
                callCounts[index]++;
              };
              listeners.push(listener);
              emitter.on(eventName, listener);
            }

            // Remove one listener
            emitter.off(eventName, listeners[validRemoveIndex]);

            // Emit the event
            emitter.emit(eventName);

            // The removed listener should not be called
            expect(callCounts[validRemoveIndex]).toBe(0);

            // All other listeners should be called
            for (let i = 0; i < listenerCount; i++) {
              if (i !== validRemoveIndex) {
                expect(callCounts[i]).toBe(1);
              }
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    /**
     * Property: Listeners registered with 'once' should be called exactly once
     * Validates: Requirements 14.4
     */
    it("should call once() listeners exactly once even when event is emitted multiple times", () => {
      fc.assert(
        fc.property(
          fc.string(), // event name
          fc.integer({ min: 2, max: 10 }), // number of times to emit
          (eventName, emitCount) => {
            const emitter = new EventEmitter();
            let callCount = 0;

            emitter.once(eventName, () => {
              callCount++;
            });

            // Emit the event multiple times
            for (let i = 0; i < emitCount; i++) {
              emitter.emit(eventName);
            }

            // Listener should be called exactly once
            expect(callCount).toBe(1);
          }
        ),
        { numRuns: 100 }
      );
    });

    /**
     * Property: Multiple listeners should be called in registration order
     * Validates: Requirements 14.5, 14.6
     */
    it("should call multiple listeners in registration order", () => {
      fc.assert(
        fc.property(
          fc.string(), // event name
          fc.integer({ min: 2, max: 10 }), // number of listeners
          (eventName, listenerCount) => {
            const emitter = new EventEmitter();
            const callOrder: number[] = [];

            // Register multiple listeners
            for (let i = 0; i < listenerCount; i++) {
              const index = i;
              emitter.on(eventName, () => {
                callOrder.push(index);
              });
            }

            // Emit the event
            emitter.emit(eventName);

            // Listeners should be called in registration order
            expect(callOrder).toEqual(
              Array.from({ length: listenerCount }, (_, i) => i)
            );
          }
        ),
        { numRuns: 100 }
      );
    });

    /**
     * Property: Same event can have multiple listeners registered
     * Validates: Requirements 14.6
     */
    it("should support multiple listeners for the same event", () => {
      fc.assert(
        fc.property(
          fc.string(), // event name
          fc.integer({ min: 1, max: 20 }), // number of listeners
          (eventName, listenerCount) => {
            const emitter = new EventEmitter();
            let totalCalls = 0;

            // Register multiple listeners for the same event
            for (let i = 0; i < listenerCount; i++) {
              emitter.on(eventName, () => {
                totalCalls++;
              });
            }

            // Emit the event once
            emitter.emit(eventName);

            // All listeners should be called
            expect(totalCalls).toBe(listenerCount);
          }
        ),
        { numRuns: 100 }
      );
    });

    /**
     * Property: Event arguments should be passed correctly to all listeners
     * Validates: Requirements 14.2, 14.5
     */
    it("should pass event arguments correctly to all listeners", () => {
      fc.assert(
        fc.property(
          fc.string(), // event name
          fc.array(fc.anything()), // random arguments
          fc.integer({ min: 1, max: 5 }), // number of listeners
          (eventName, args, listenerCount) => {
            const emitter = new EventEmitter();
            const receivedArgs: any[][] = [];

            // Register multiple listeners
            for (let i = 0; i < listenerCount; i++) {
              emitter.on(eventName, (...received: any[]) => {
                receivedArgs.push(received);
              });
            }

            // Emit the event with arguments
            emitter.emit(eventName, ...args);

            // All listeners should receive the same arguments
            expect(receivedArgs.length).toBe(listenerCount);
            for (const received of receivedArgs) {
              expect(received).toEqual(args);
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    /**
     * Property: Emitting non-existent event should not throw error
     * Validates: Requirements 14.1 (robustness)
     */
    it("should not throw error when emitting event with no listeners", () => {
      fc.assert(
        fc.property(
          fc.string(), // event name
          fc.array(fc.anything()), // random arguments
          (eventName, args) => {
            const emitter = new EventEmitter();

            // Should not throw
            expect(() => {
              emitter.emit(eventName, ...args);
            }).not.toThrow();
          }
        ),
        { numRuns: 100 }
      );
    });

    /**
     * Property: Removing non-existent listener should not throw error
     * Validates: Requirements 14.3 (robustness)
     */
    it("should not throw error when removing non-existent listener", () => {
      fc.assert(
        fc.property(
          fc.string(), // event name
          (eventName) => {
            const emitter = new EventEmitter();
            const dummyListener = () => {};

            // Should not throw
            expect(() => {
              emitter.off(eventName, dummyListener);
            }).not.toThrow();
          }
        ),
        { numRuns: 100 }
      );
    });

    /**
     * Property: removeAllListeners should remove all listeners for an event
     * Validates: Requirements 14.3
     */
    it("should remove all listeners when removeAllListeners is called for specific event", () => {
      fc.assert(
        fc.property(
          fc.string(), // event name
          fc.integer({ min: 1, max: 10 }), // number of listeners
          (eventName, listenerCount) => {
            const emitter = new EventEmitter();
            let callCount = 0;

            // Register multiple listeners
            for (let i = 0; i < listenerCount; i++) {
              emitter.on(eventName, () => {
                callCount++;
              });
            }

            // Remove all listeners for this event
            emitter.removeAllListeners(eventName);

            // Emit the event
            emitter.emit(eventName);

            // No listeners should be called
            expect(callCount).toBe(0);
          }
        ),
        { numRuns: 100 }
      );
    });

    /**
     * Property: removeAllListeners without argument should remove all listeners for all events
     * Validates: Requirements 14.3
     */
    it("should remove all listeners for all events when removeAllListeners is called without argument", () => {
      fc.assert(
        fc.property(
          fc.array(fc.string(), { minLength: 1, maxLength: 5 }), // multiple event names
          fc.integer({ min: 1, max: 5 }), // listeners per event
          (eventNames, listenersPerEvent) => {
            const emitter = new EventEmitter();
            let totalCalls = 0;

            // Register listeners for multiple events
            for (const eventName of eventNames) {
              for (let i = 0; i < listenersPerEvent; i++) {
                emitter.on(eventName, () => {
                  totalCalls++;
                });
              }
            }

            // Remove all listeners for all events
            emitter.removeAllListeners();

            // Emit all events
            for (const eventName of eventNames) {
              emitter.emit(eventName);
            }

            // No listeners should be called
            expect(totalCalls).toBe(0);
          }
        ),
        { numRuns: 100 }
      );
    });

    /**
     * Property: Method chaining should work correctly
     * Validates: Requirements 14.1, 14.2, 14.3 (API design)
     */
    it("should support method chaining for on() and off()", () => {
      fc.assert(
        fc.property(
          fc.string(), // event name
          (eventName) => {
            const emitter = new EventEmitter();
            let count1 = 0;
            let count2 = 0;

            const listener1 = () => {
              count1++;
            };
            const listener2 = () => {
              count2++;
            };

            // Chain multiple on() calls for the same event
            const result = emitter
              .on(eventName, listener1)
              .on(eventName, listener2);

            // Should return the emitter instance
            expect(result).toBe(emitter);

            // Emit event
            emitter.emit(eventName);

            // Both listeners should be called
            expect(count1).toBe(1);
            expect(count2).toBe(1);

            // Chain off() calls
            const offResult = emitter
              .off(eventName, listener1)
              .off(eventName, listener2);

            // Should return the emitter instance
            expect(offResult).toBe(emitter);

            // Reset counts
            count1 = 0;
            count2 = 0;

            // Emit event again
            emitter.emit(eventName);

            // No listeners should be called
            expect(count1).toBe(0);
            expect(count2).toBe(0);
          }
        ),
        { numRuns: 100 }
      );
    });

    /**
     * Property: once() listeners should be removed after being called
     * Validates: Requirements 14.4
     */
    it("should automatically remove once() listeners after they are called", () => {
      fc.assert(
        fc.property(
          fc.string(), // event name
          (eventName) => {
            const emitter = new EventEmitter();
            let callCount = 0;

            emitter.once(eventName, () => {
              callCount++;
            });

            // First emit should call the listener
            emitter.emit(eventName);
            expect(callCount).toBe(1);

            // Second emit should not call the listener (it was removed)
            emitter.emit(eventName);
            expect(callCount).toBe(1);

            // Third emit should still not call the listener
            emitter.emit(eventName);
            expect(callCount).toBe(1);
          }
        ),
        { numRuns: 100 }
      );
    });

    /**
     * Property: Mixing on() and once() listeners should work correctly
     * Validates: Requirements 14.1, 14.2, 14.4, 14.5
     */
    it("should handle mixed on() and once() listeners correctly", () => {
      fc.assert(
        fc.property(
          fc.string(), // event name
          fc.integer({ min: 1, max: 5 }), // number of on() listeners
          fc.integer({ min: 1, max: 5 }), // number of once() listeners
          fc.integer({ min: 2, max: 5 }), // number of emits
          (eventName, onCount, onceCount, emitCount) => {
            const emitter = new EventEmitter();
            let onCallCount = 0;
            let onceCallCount = 0;

            // Register on() listeners
            for (let i = 0; i < onCount; i++) {
              emitter.on(eventName, () => {
                onCallCount++;
              });
            }

            // Register once() listeners
            for (let i = 0; i < onceCount; i++) {
              emitter.once(eventName, () => {
                onceCallCount++;
              });
            }

            // Emit multiple times
            for (let i = 0; i < emitCount; i++) {
              emitter.emit(eventName);
            }

            // on() listeners should be called emitCount times
            expect(onCallCount).toBe(onCount * emitCount);

            // once() listeners should be called only once (on first emit)
            expect(onceCallCount).toBe(onceCount);
          }
        ),
        { numRuns: 100 }
      );
    });
  });
});
