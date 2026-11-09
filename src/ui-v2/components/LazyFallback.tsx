export function LazyFallback() {
  return (
    <div className="flex min-h-0 flex-1 items-center justify-center bg-background">
      <div className="size-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
    </div>
  );
}

export default LazyFallback;
