let counter = 0;
let generator = (prefix) => {
  const rnd = globalThis.crypto.randomUUID().replaceAll('-', '').slice(0, 10);
  return `${prefix}_${rnd}${(counter++).toString(36)}`;
};

export const newId = (prefix) => generator(prefix);

/** Solo para tests: ids deterministas. Sin argumento restaura el generador real. */
export function setIdGenerator(fn) {
  counter = 0;
  generator = fn ?? ((prefix) => `${prefix}_${globalThis.crypto.randomUUID().replaceAll('-', '').slice(0, 10)}${(counter++).toString(36)}`);
}
