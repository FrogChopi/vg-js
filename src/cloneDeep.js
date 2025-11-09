/**
 * Performs a deep clone of an object, preserving class instances and their methods.
 * This is a more robust deep clone than JSON.parse(JSON.stringify(obj)).
 *
 * @param {object} obj The object to clone.
 * @param {WeakMap} hash A WeakMap to store seen objects to prevent circular references.
 * @returns {object} The deep cloned object.
 */
export default function cloneDeep(obj, hash = new WeakMap()) {
    if (obj === null || typeof obj !== 'object') return obj;
    if (hash.has(obj)) return hash.get(obj);

    // Handle Date and RegExp objects
    if (obj instanceof Date) return new Date(obj);
    if (obj instanceof RegExp) return new RegExp(obj);

    // Handle class instances
    let clone;
    if (obj.constructor !== Object && obj.constructor !== Array) {
        // If it's a class instance, create a new instance of that class
        // Create a new object with the same prototype, but without calling the constructor
        clone = Object.create(Object.getPrototypeOf(obj));
    } else {
        // If it's a plain object or array, create a new plain object or array
        clone = Array.isArray(obj) ? [] : {};
    }

    hash.set(obj, clone);

    for (const key in obj) {
        if (Object.prototype.hasOwnProperty.call(obj, key)) {
            clone[key] = cloneDeep(obj[key], hash);
        }
    }

    return clone;
}
