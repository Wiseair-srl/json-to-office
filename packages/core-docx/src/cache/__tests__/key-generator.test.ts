import { describe, it, expect, beforeEach } from 'vitest';
import { CacheKeyGenerator } from '../key-generator';

describe('cache/key-generator', () => {
  describe('CacheKeyGenerator', () => {
    let generator: CacheKeyGenerator;

    beforeEach(() => {
      generator = new CacheKeyGenerator();
    });

    it('should generate consistent keys for the same config', () => {
      const config = { test: 'value', number: 123 };
      const key1 = generator.hashProps(config);
      const key2 = generator.hashProps(config);

      expect(key1).toBe(key2);
    });

    it('should generate different keys for different configs', () => {
      const config1 = { test: 'value1' };
      const config2 = { test: 'value2' };

      const key1 = generator.hashProps(config1);
      const key2 = generator.hashProps(config2);

      expect(key1).not.toBe(key2);
    });

    it('should handle simple strings', () => {
      const key = generator.hashProps('simple string');

      expect(key).toBeDefined();
      expect(typeof key).toBe('string');
      expect(key.length).toBe(16); // hashProps returns 16 chars
    });

    it('should handle numbers', () => {
      const key1 = generator.hashProps(123);
      const key2 = generator.hashProps(456);

      expect(key1).not.toBe(key2);
    });

    it('should handle booleans', () => {
      const keyTrue = generator.hashProps(true);
      const keyFalse = generator.hashProps(false);

      expect(keyTrue).not.toBe(keyFalse);
    });

    it('should handle arrays', () => {
      const key1 = generator.hashProps([1, 2, 3]);
      const key2 = generator.hashProps([1, 2, 3]);
      const key3 = generator.hashProps([3, 2, 1]);

      expect(key1).toBe(key2);
      expect(key1).not.toBe(key3);
    });

    it('should handle nested objects', () => {
      const data1 = {
        level1: {
          level2: {
            value: 'deep',
          },
        },
      };

      const data2 = {
        level1: {
          level2: {
            value: 'deep',
          },
        },
      };

      const data3 = {
        level1: {
          level2: {
            value: 'different',
          },
        },
      };

      const key1 = generator.hashProps(data1);
      const key2 = generator.hashProps(data2);
      const key3 = generator.hashProps(data3);

      expect(key1).toBe(key2);
      expect(key1).not.toBe(key3);
    });

    it('should handle null and undefined', () => {
      const keyNull = generator.hashProps(null);
      const keyUndefined = generator.hashProps(undefined);
      const keyEmpty = generator.hashProps({});

      expect(keyNull).toBe('null'); // hashProps returns 'null' for null
      expect(keyUndefined).toBe('null'); // and for undefined
      expect(keyEmpty).toBeDefined();
      expect(keyEmpty).not.toBe(keyNull);
    });

    it('should handle objects with different key orders consistently', () => {
      const data1 = { a: 1, b: 2, c: 3 };
      const data2 = { c: 3, a: 1, b: 2 };

      const key1 = generator.hashProps(data1);
      const key2 = generator.hashProps(data2);

      // The normalizeObject method sorts keys, so these should be the same
      expect(key1).toBe(key2);
    });

    it('should handle complex mixed data structures', () => {
      const complexData = {
        string: 'test',
        number: 42,
        boolean: true,
        array: [1, 'two', { three: 3 }],
        nested: {
          deep: {
            value: 'found',
          },
        },
        nullValue: null,
        undefinedValue: undefined,
      };

      const key = generator.hashProps(complexData);

      expect(key).toBeDefined();
      expect(typeof key).toBe('string');
      expect(key.length).toBe(16);
    });

    it('should generate fixed-length hash strings', () => {
      const data = { someData: 'with a lot of content that is very long' };
      const key = generator.hashProps(data);

      // hashProps returns first 16 chars of hash
      expect(key.length).toBe(16);
    });

    it('should handle special characters in strings', () => {
      const data1 = 'Special chars: !@#$%^&*()';
      const data2 = 'Special chars: !@#$%^&*()';
      const data3 = 'Different: !@#$%^&*()';

      const key1 = generator.hashProps(data1);
      const key2 = generator.hashProps(data2);
      const key3 = generator.hashProps(data3);

      expect(key1).toBe(key2);
      expect(key1).not.toBe(key3);
    });

    it('should handle empty arrays and objects differently', () => {
      const keyEmptyArray = generator.hashProps([]);
      const keyEmptyObject = generator.hashProps({});

      expect(keyEmptyArray).not.toBe(keyEmptyObject);
    });

    it('should handle dates', () => {
      const date1 = new Date('2024-01-01');
      const date2 = new Date('2024-01-01');
      const date3 = new Date('2024-01-02');

      const key1 = generator.hashProps(date1);
      const key2 = generator.hashProps(date2);
      const key3 = generator.hashProps(date3);

      expect(key1).toBe(key2);
      expect(key1).not.toBe(key3);
    });
  });
});
