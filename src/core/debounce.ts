export class Debouncer {
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor(private readonly delayMs: number) {}

  schedule(fn: () => void): void {
    if (this.timer !== undefined) {
      clearTimeout(this.timer);
    }
    this.timer = setTimeout(() => {
      this.timer = undefined;
      fn();
    }, this.delayMs);
  }

  dispose(): void {
    if (this.timer !== undefined) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
  }
}
