/** Appends `value` to the list under `key`, creating it on first use (linear, unlike copying the list each time). */
export function pushTo<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const list = map.get(key);
  if (list) list.push(value);
  else map.set(key, [value]);
}
