/**
 * Unit tests for EventEmitter
 * Tests specific examples and edge cases for the event system
 *
 * Requirements: 14.1-14.6
 */

import { EventEmitter } from "../../core/EventEmitter";

describe("EventEmitter Unit Tests", () => {
  let emitter: EventEmitter;

  beforeEach(() => {
    emitter = new EventEmitter();
  });

  describe("Event registration and triggering", () => {
    it("should support typed event maps declared as normal interfaces", () => {
      interface TypedEvents {
        data: [payload: string, count: number];
        close: [];
      }

      const typedEmitter = new EventEmitter<TypedEvents>();
      const listener = jest.fn((payload: string, count: number) => {
        expect(payload.toUpperCase()).toBe("HELLO");
        expect(count.toFixed(0)).toBe("42");
      });

      typedEmitter.on("data", listener);
      typedEmitter.emit("data", "hello", 42);

      expect(listener).toHaveBeenCalledWith("hello", 42);
    });

    it("should register and trigger a single listener", () => {
      const listener = jest.fn();
      emitter.on("test", listener);
      emitter.emit("test");

      expect(listener).toHaveBeenCalledTimes(1);
    });

    it("should pass arguments to listeners", () => {
      const listener = jest.fn();
      emitter.on("test", listener);
      emitter.emit("test", "arg1", 42, { key: "value" });

      expect(listener).toHaveBeenCalledWith("arg1", 42, { key: "value" });
    });

    it("should trigger multiple listeners for the same event", () => {
      const listener1 = jest.fn();
      const listener2 = jest.fn();
      const listener3 = jest.fn();

      emitter.on("test", listener1);
      emitter.on("test", listener2);
      emitter.on("test", listener3);

      emitter.emit("test");

      expect(listener1).toHaveBeenCalledTimes(1);
      expect(listener2).toHaveBeenCalledTimes(1);
      expect(listener3).toHaveBeenCalledTimes(1);
    });

    it("should not trigger listeners for different events", () => {
      const listener1 = jest.fn();
      const listener2 = jest.fn();

      emitter.on("event1", listener1);
      emitter.on("event2", listener2);

      emitter.emit("event1");

      expect(listener1).toHaveBeenCalledTimes(1);
      expect(listener2).not.toHaveBeenCalled();
    });

    it("should handle emitting events with no listeners", () => {
      expect(() => {
        emitter.emit("nonexistent");
      }).not.toThrow();
    });

    it("should support method chaining for on()", () => {
      const listener1 = jest.fn();
      const listener2 = jest.fn();

      const result = emitter.on("test", listener1).on("test", listener2);

      expect(result).toBe(emitter);
      emitter.emit("test");
      expect(listener1).toHaveBeenCalledTimes(1);
      expect(listener2).toHaveBeenCalledTimes(1);
    });
  });

  describe("once() listeners", () => {
    it("should call once() listener only once", () => {
      const listener = jest.fn();
      emitter.once("test", listener);

      emitter.emit("test");
      emitter.emit("test");
      emitter.emit("test");

      expect(listener).toHaveBeenCalledTimes(1);
    });

    it("should pass arguments to once() listeners", () => {
      const listener = jest.fn();
      emitter.once("test", listener);
      emitter.emit("test", "arg1", 42);

      expect(listener).toHaveBeenCalledWith("arg1", 42);
    });

    it("should support multiple once() listeners", () => {
      const listener1 = jest.fn();
      const listener2 = jest.fn();

      emitter.once("test", listener1);
      emitter.once("test", listener2);

      emitter.emit("test");

      expect(listener1).toHaveBeenCalledTimes(1);
      expect(listener2).toHaveBeenCalledTimes(1);

      emitter.emit("test");

      expect(listener1).toHaveBeenCalledTimes(1);
      expect(listener2).toHaveBeenCalledTimes(1);
    });

    it("should work correctly when mixed with on() listeners", () => {
      const onListener = jest.fn();
      const onceListener = jest.fn();

      emitter.on("test", onListener);
      emitter.once("test", onceListener);

      emitter.emit("test");
      expect(onListener).toHaveBeenCalledTimes(1);
      expect(onceListener).toHaveBeenCalledTimes(1);

      emitter.emit("test");
      expect(onListener).toHaveBeenCalledTimes(2);
      expect(onceListener).toHaveBeenCalledTimes(1);
    });

    it("should support method chaining for once()", () => {
      const listener1 = jest.fn();
      const listener2 = jest.fn();

      const result = emitter.once("test", listener1).once("test", listener2);

      expect(result).toBe(emitter);
      emitter.emit("test");
      expect(listener1).toHaveBeenCalledTimes(1);
      expect(listener2).toHaveBeenCalledTimes(1);
    });
  });

  describe("Listener call order", () => {
    it("should call listeners in registration order", () => {
      const callOrder: number[] = [];

      emitter.on("test", () => callOrder.push(1));
      emitter.on("test", () => callOrder.push(2));
      emitter.on("test", () => callOrder.push(3));

      emitter.emit("test");

      expect(callOrder).toEqual([1, 2, 3]);
    });

    it("should maintain order when mixing on() and once()", () => {
      const callOrder: number[] = [];

      emitter.on("test", () => callOrder.push(1));
      emitter.once("test", () => callOrder.push(2));
      emitter.on("test", () => callOrder.push(3));
      emitter.once("test", () => callOrder.push(4));

      emitter.emit("test");

      expect(callOrder).toEqual([1, 2, 3, 4]);
    });

    it("should maintain order after removing a listener", () => {
      const callOrder: number[] = [];
      const listener2 = () => callOrder.push(2);

      emitter.on("test", () => callOrder.push(1));
      emitter.on("test", listener2);
      emitter.on("test", () => callOrder.push(3));

      emitter.off("test", listener2);
      emitter.emit("test");

      expect(callOrder).toEqual([1, 3]);
    });
  });

  describe("off() method", () => {
    it("should remove a specific listener", () => {
      const listener1 = jest.fn();
      const listener2 = jest.fn();

      emitter.on("test", listener1);
      emitter.on("test", listener2);

      emitter.off("test", listener1);
      emitter.emit("test");

      expect(listener1).not.toHaveBeenCalled();
      expect(listener2).toHaveBeenCalledTimes(1);
    });

    it("should handle removing non-existent listener", () => {
      const listener = jest.fn();

      expect(() => {
        emitter.off("test", listener);
      }).not.toThrow();
    });

    it("should handle removing listener from non-existent event", () => {
      const listener = jest.fn();

      expect(() => {
        emitter.off("nonexistent", listener);
      }).not.toThrow();
    });

    it("should support method chaining for off()", () => {
      const listener1 = jest.fn();
      const listener2 = jest.fn();

      emitter.on("test", listener1);
      emitter.on("test", listener2);

      const result = emitter.off("test", listener1).off("test", listener2);

      expect(result).toBe(emitter);
      emitter.emit("test");
      expect(listener1).not.toHaveBeenCalled();
      expect(listener2).not.toHaveBeenCalled();
    });

    it("should clean up event entry when last listener is removed", () => {
      const listener = jest.fn();

      emitter.on("test", listener);
      emitter.off("test", listener);

      // Emit should not throw even though event was cleaned up
      expect(() => {
        emitter.emit("test");
      }).not.toThrow();
    });
  });

  describe("removeAllListeners()", () => {
    it("should remove all listeners for a specific event", () => {
      const listener1 = jest.fn();
      const listener2 = jest.fn();
      const listener3 = jest.fn();

      emitter.on("test", listener1);
      emitter.on("test", listener2);
      emitter.on("other", listener3);

      emitter.removeAllListeners("test");
      emitter.emit("test");
      emitter.emit("other");

      expect(listener1).not.toHaveBeenCalled();
      expect(listener2).not.toHaveBeenCalled();
      expect(listener3).toHaveBeenCalledTimes(1);
    });

    it("should remove all listeners for all events when no argument provided", () => {
      const listener1 = jest.fn();
      const listener2 = jest.fn();
      const listener3 = jest.fn();

      emitter.on("event1", listener1);
      emitter.on("event2", listener2);
      emitter.on("event3", listener3);

      emitter.removeAllListeners();

      emitter.emit("event1");
      emitter.emit("event2");
      emitter.emit("event3");

      expect(listener1).not.toHaveBeenCalled();
      expect(listener2).not.toHaveBeenCalled();
      expect(listener3).not.toHaveBeenCalled();
    });

    it("should handle removing listeners from non-existent event", () => {
      expect(() => {
        emitter.removeAllListeners("nonexistent");
      }).not.toThrow();
    });

    it("should remove both on() and once() listeners", () => {
      const onListener = jest.fn();
      const onceListener = jest.fn();

      emitter.on("test", onListener);
      emitter.once("test", onceListener);

      emitter.removeAllListeners("test");
      emitter.emit("test");

      expect(onListener).not.toHaveBeenCalled();
      expect(onceListener).not.toHaveBeenCalled();
    });

    it("should allow re-registering listeners after removeAllListeners", () => {
      const listener = jest.fn();

      emitter.on("test", listener);
      emitter.removeAllListeners("test");
      emitter.on("test", listener);
      emitter.emit("test");

      expect(listener).toHaveBeenCalledTimes(1);
    });
  });

  describe("Edge cases", () => {
    it("should handle empty event names", () => {
      const listener = jest.fn();

      emitter.on("", listener);
      emitter.emit("");

      expect(listener).toHaveBeenCalledTimes(1);
    });

    it("should handle listeners that throw errors", () => {
      const errorListener = jest.fn(() => {
        throw new Error("Listener error");
      });
      const normalListener = jest.fn();

      emitter.on("test", errorListener);
      emitter.on("test", normalListener);

      // The error should propagate, but we can test that it happens
      expect(() => {
        emitter.emit("test");
      }).toThrow("Listener error");

      // First listener was called
      expect(errorListener).toHaveBeenCalledTimes(1);
      // Second listener should not be called due to error
      expect(normalListener).not.toHaveBeenCalled();
    });

    it("should handle listeners that modify the emitter during emit", () => {
      const callOrder: number[] = [];
      let listener2: Function;

      const listener1 = () => {
        callOrder.push(1);
        // Remove listener2 during emit
        emitter.off("test", listener2);
      };

      listener2 = () => {
        callOrder.push(2);
      };

      const listener3 = () => {
        callOrder.push(3);
      };

      emitter.on("test", listener1);
      emitter.on("test", listener2);
      emitter.on("test", listener3);

      emitter.emit("test");

      // All listeners should be called because we snapshot the listeners
      expect(callOrder).toEqual([1, 2, 3]);

      // But listener2 should be removed for next emit
      callOrder.length = 0;
      emitter.emit("test");
      expect(callOrder).toEqual([1, 3]);
    });

    it("should handle adding listeners during emit", () => {
      const callOrder: number[] = [];

      const listener1 = () => {
        callOrder.push(1);
        // Add a new listener during emit
        emitter.on("test", () => callOrder.push(3));
      };

      const listener2 = () => {
        callOrder.push(2);
      };

      emitter.on("test", listener1);
      emitter.on("test", listener2);

      emitter.emit("test");

      // New listener should not be called in the same emit
      expect(callOrder).toEqual([1, 2]);

      // But should be called in the next emit
      callOrder.length = 0;
      emitter.emit("test");
      expect(callOrder).toEqual([1, 2, 3]);
    });

    it("should handle multiple emits in sequence", () => {
      const listener = jest.fn();

      emitter.on("test", listener);

      emitter.emit("test", 1);
      emitter.emit("test", 2);
      emitter.emit("test", 3);

      expect(listener).toHaveBeenCalledTimes(3);
      expect(listener).toHaveBeenNthCalledWith(1, 1);
      expect(listener).toHaveBeenNthCalledWith(2, 2);
      expect(listener).toHaveBeenNthCalledWith(3, 3);
    });

    it("should handle same listener registered multiple times", () => {
      const listener = jest.fn();

      emitter.on("test", listener);
      emitter.on("test", listener);
      emitter.on("test", listener);

      emitter.emit("test");

      // Set only stores unique functions, so listener should be called once
      expect(listener).toHaveBeenCalledTimes(1);
    });
  });
});
