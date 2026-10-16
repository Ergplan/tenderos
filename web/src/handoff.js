// A file handed from one dashboard tab to another (Tender to Bid → BESS tender). Kept in
// memory only, for the next tab that takes it.
let pending = null;

export function handOff(file) {
  pending = file;
}

export function takeHandOff() {
  const file = pending;
  pending = null;
  return file;
}

export function hasHandOff() {
  return pending !== null;
}
