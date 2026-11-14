//! A stable hash for deterministic, RNG-free choices derived from ids.

/// 64-bit value derived only from `seed` and `key`: FNV-1a with a splitmix64
/// finalizer. There is no RNG state, so the same input gives the same output on
/// every run and machine.
pub(crate) fn stable_hash(seed: &str, key: &str) -> u64 {
    let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
    for byte in seed.bytes().chain(std::iter::once(b':')).chain(key.bytes()) {
        hash ^= u64::from(byte);
        hash = hash.wrapping_mul(0x0000_0100_0000_01b3);
    }
    hash ^= hash >> 30;
    hash = hash.wrapping_mul(0xbf58_476d_1ce4_e5b9);
    hash ^= hash >> 27;
    hash = hash.wrapping_mul(0x94d0_49bb_1331_11eb);
    hash ^ (hash >> 31)
}

#[cfg(test)]
mod tests {
    use super::stable_hash;

    #[test]
    fn same_input_gives_the_same_hash() {
        assert_eq!(
            stable_hash("team-1", "reputation"),
            stable_hash("team-1", "reputation")
        );
    }

    #[test]
    fn seed_and_key_both_change_the_hash() {
        let base = stable_hash("team-1", "reputation");
        assert_ne!(base, stable_hash("team-2", "reputation"));
        assert_ne!(base, stable_hash("team-1", "finance"));
    }
}
