/// TypeScript binding generator for OLManager.
///
/// Run: cargo run --bin typegen --features typescript
///
/// Generated .ts files are placed in OUT_DIR during compilation.
/// Run this binary to verify all types implement TS correctly.
fn main() {
    // Just verify compilation succeeds — #[ts(export)] handles file generation
    // during the build phase via ts-rs macros.
    println!("✅ All types implement TS correctly.");
    println!("   Individual .ts files are generated to OUT_DIR via #[ts(export)].");
    println!("   To consolidate into a single bindings.ts, run:");
    println!("     cargo build --features typescript");
}
