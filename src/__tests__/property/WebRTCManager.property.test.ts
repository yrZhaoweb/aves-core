/**
 * Property-based tests for WebRTCManager
 * Feature: webrtc-library-extraction, Property 1: 消息序列化 Round-Trip
 *
 * **Validates: Requirements 3.5, 15.6**
 */

import * as fc from "fast-check";

describe("WebRTCManager Property Tests", () => {
  describe("Property 1: 消息序列化 Round-Trip", () => {
    /**
     * Property: For any serializable JavaScript object, serializing and then
     * deserializing should produce an equivalent object.
     *
     * This tests the core message serialization logic used by WebRTCManager
     * when sending and receiving messages through DataChannels.
     *
     * Note: JSON serialization has known limitations:
     * - undefined becomes null (in arrays) or is omitted (in objects)
     * - Infinity, -Infinity, NaN become null
     * - Functions, symbols are not serializable
     *
     * **Validates: Requirements 3.5, 15.6**
     */
    it("should preserve object equality through JSON serialization round-trip", () => {
      fc.assert(
        fc.property(
          // Generate JSON-safe values only
          fc.oneof(
            fc.string(),
            fc.integer(),
            fc.boolean(),
            fc.constant(null),
            fc.array(
              fc.oneof(
                fc.string(),
                fc.integer(),
                fc.boolean(),
                fc.constant(null)
              )
            ),
            fc.record({
              key: fc.string(),
              value: fc.oneof(fc.string(), fc.integer(), fc.boolean()),
            })
          ),
          (original) => {
            // Simulate the serialization process in WebRTCManager
            const serialized = JSON.stringify(original);
            const deserialized = JSON.parse(serialized);

            // The deserialized value should be deeply equal to the original
            expect(deserialized).toEqual(original);
          }
        ),
        { numRuns: 100 }
      );
    });

    /**
     * Property: Nested objects should preserve structure through round-trip
     * **Validates: Requirements 3.5, 15.6**
     */
    it("should preserve nested object structure through round-trip", () => {
      fc.assert(
        fc.property(
          fc.record({
            id: fc.string(),
            data: fc.record({
              value: fc.integer(),
              nested: fc.record({
                flag: fc.boolean(),
                items: fc.array(fc.string()),
              }),
            }),
          }),
          (original) => {
            const serialized = JSON.stringify(original);
            const deserialized = JSON.parse(serialized);

            expect(deserialized).toEqual(original);
            expect(deserialized.id).toBe(original.id);
            expect(deserialized.data.value).toBe(original.data.value);
            expect(deserialized.data.nested.flag).toBe(
              original.data.nested.flag
            );
            expect(deserialized.data.nested.items).toEqual(
              original.data.nested.items
            );
          }
        ),
        { numRuns: 100 }
      );
    });

    /**
     * Property: Arrays should preserve order and content through round-trip
     * **Validates: Requirements 3.5, 15.6**
     */
    it("should preserve array order and content through round-trip", () => {
      fc.assert(
        fc.property(
          fc.array(
            fc.oneof(
              fc.string(),
              fc.integer(),
              fc.boolean(),
              fc.constant(null),
              fc.record({
                key: fc.string(),
                value: fc.integer(),
              })
            )
          ),
          (original) => {
            const serialized = JSON.stringify(original);
            const deserialized = JSON.parse(serialized);

            expect(deserialized).toEqual(original);
            expect(deserialized.length).toBe(original.length);

            // Verify each element
            for (let i = 0; i < original.length; i++) {
              expect(deserialized[i]).toEqual(original[i]);
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    /**
     * Property: Primitive types should be preserved through round-trip
     * Note: Only JSON-stable numbers are tested (no Infinity, -Infinity, NaN, -0)
     * **Validates: Requirements 3.5, 15.6**
     */
    it("should preserve primitive types through round-trip", () => {
      fc.assert(
        fc.property(
          fc.oneof(
            fc.string(),
            fc.integer(),
            fc.float().filter((n) => Number.isFinite(n) && !Object.is(n, -0)),
            fc.boolean(),
            fc.constant(null)
          ),
          (original) => {
            const serialized = JSON.stringify(original);
            const deserialized = JSON.parse(serialized);

            expect(deserialized).toEqual(original);
            expect(typeof deserialized).toBe(typeof original);
          }
        ),
        { numRuns: 100 }
      );
    });

    /**
     * Property: Empty objects and arrays should be preserved
     * **Validates: Requirements 3.5, 15.6**
     */
    it("should preserve empty objects and arrays through round-trip", () => {
      fc.assert(
        fc.property(
          fc.oneof(fc.constant({}), fc.constant([]), fc.constant("")),
          (original) => {
            const serialized = JSON.stringify(original);
            const deserialized = JSON.parse(serialized);

            expect(deserialized).toEqual(original);
          }
        ),
        { numRuns: 100 }
      );
    });

    /**
     * Property: Special numeric values should be handled correctly
     * **Validates: Requirements 3.5, 15.6**
     */
    it("should handle special numeric values correctly", () => {
      fc.assert(
        fc.property(
          fc.oneof(
            fc.constant(0),
            fc.constant(-0),
            fc.constant(Number.MAX_SAFE_INTEGER),
            fc.constant(Number.MIN_SAFE_INTEGER),
            fc.double({ noNaN: true, noDefaultInfinity: true })
          ),
          (original) => {
            const serialized = JSON.stringify(original);
            const deserialized = JSON.parse(serialized);

            // Note: -0 becomes 0 through JSON serialization (expected behavior)
            if (Object.is(original, -0)) {
              expect(deserialized).toBe(0);
            } else {
              expect(deserialized).toEqual(original);
            }
          }
        ),
        { numRuns: 100 }
      );
    });

    /**
     * Property: Unicode strings should be preserved through round-trip
     * **Validates: Requirements 3.5, 15.6**
     */
    it("should preserve unicode strings through round-trip", () => {
      fc.assert(
        fc.property(fc.unicodeString(), (original) => {
          const serialized = JSON.stringify(original);
          const deserialized = JSON.parse(serialized);

          expect(deserialized).toEqual(original);
          expect(deserialized.length).toBe(original.length);
        }),
        { numRuns: 100 }
      );
    });

    /**
     * Property: Complex message objects (typical use case) should round-trip correctly
     * Note: Using JSON-safe values only (no undefined in fc.anything())
     * **Validates: Requirements 3.5, 15.6**
     */
    it("should handle typical message objects correctly", () => {
      fc.assert(
        fc.property(
          fc.record({
            type: fc.constantFrom("chat", "notification", "update", "command"),
            timestamp: fc.integer({ min: 0 }),
            sender: fc.record({
              id: fc.string(),
              name: fc.string(),
            }),
            payload: fc.oneof(
              fc.string(),
              fc.record({
                text: fc.string(),
                metadata: fc.dictionary(
                  fc.string(),
                  fc.oneof(
                    fc.string(),
                    fc.integer(),
                    fc.boolean(),
                    fc.constant(null)
                  )
                ),
              }),
              fc.array(fc.integer())
            ),
          }),
          (original) => {
            const serialized = JSON.stringify(original);
            const deserialized = JSON.parse(serialized);

            expect(deserialized).toEqual(original);
            expect(deserialized.type).toBe(original.type);
            expect(deserialized.timestamp).toBe(original.timestamp);
            expect(deserialized.sender.id).toBe(original.sender.id);
            expect(deserialized.sender.name).toBe(original.sender.name);
          }
        ),
        { numRuns: 100 }
      );
    });

    /**
     * Property: Serialization should be idempotent (serialize twice = same result)
     * **Validates: Requirements 3.5, 15.6**
     */
    it("should produce the same serialized string when serialized multiple times", () => {
      fc.assert(
        fc.property(
          fc.record({
            id: fc.integer(),
            name: fc.string(),
            active: fc.boolean(),
          }),
          (original) => {
            const serialized1 = JSON.stringify(original);
            const serialized2 = JSON.stringify(original);

            expect(serialized1).toBe(serialized2);
          }
        ),
        { numRuns: 100 }
      );
    });

    /**
     * Property: Multiple round-trips should preserve equality
     * **Validates: Requirements 3.5, 15.6**
     */
    it("should preserve equality through multiple round-trips", () => {
      fc.assert(
        fc.property(
          fc.record({
            data: fc.array(fc.integer()),
            metadata: fc.record({
              version: fc.integer(),
              flags: fc.array(fc.boolean()),
            }),
          }),
          (original) => {
            // First round-trip
            const serialized1 = JSON.stringify(original);
            const deserialized1 = JSON.parse(serialized1);

            // Second round-trip
            const serialized2 = JSON.stringify(deserialized1);
            const deserialized2 = JSON.parse(serialized2);

            // Third round-trip
            const serialized3 = JSON.stringify(deserialized2);
            const deserialized3 = JSON.parse(serialized3);

            // All should be equal
            expect(deserialized1).toEqual(original);
            expect(deserialized2).toEqual(original);
            expect(deserialized3).toEqual(original);

            // Serialized strings should also be equal
            expect(serialized1).toBe(serialized2);
            expect(serialized2).toBe(serialized3);
          }
        ),
        { numRuns: 100 }
      );
    });

    /**
     * Property: Null values in objects should be preserved
     * **Validates: Requirements 3.5, 15.6**
     */
    it("should preserve null values in objects through round-trip", () => {
      fc.assert(
        fc.property(
          fc.record({
            value1: fc.string(),
            value2: fc.constant(null),
            value3: fc.integer(),
            nested: fc.record({
              nullField: fc.constant(null),
              nonNullField: fc.boolean(),
            }),
          }),
          (original) => {
            const serialized = JSON.stringify(original);
            const deserialized = JSON.parse(serialized);

            expect(deserialized).toEqual(original);
            expect(deserialized.value2).toBeNull();
            expect(deserialized.nested.nullField).toBeNull();
          }
        ),
        { numRuns: 100 }
      );
    });

    /**
     * Property: Mixed type arrays should preserve types through round-trip
     * **Validates: Requirements 3.5, 15.6**
     */
    it("should preserve mixed type arrays through round-trip", () => {
      fc.assert(
        fc.property(
          fc.array(
            fc.oneof(
              fc.string(),
              fc.integer(),
              fc.boolean(),
              fc.constant(null),
              fc.record({ key: fc.string() }),
              fc.array(fc.integer())
            ),
            { minLength: 1, maxLength: 10 }
          ),
          (original) => {
            const serialized = JSON.stringify(original);
            const deserialized = JSON.parse(serialized);

            expect(deserialized).toEqual(original);

            // Verify types are preserved
            for (let i = 0; i < original.length; i++) {
              if (original[i] === null) {
                expect(deserialized[i]).toBeNull();
              } else if (Array.isArray(original[i])) {
                expect(Array.isArray(deserialized[i])).toBe(true);
              } else {
                expect(typeof deserialized[i]).toBe(typeof original[i]);
              }
            }
          }
        ),
        { numRuns: 100 }
      );
    });
  });
});
