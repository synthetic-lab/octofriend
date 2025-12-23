export class AsyncGeneratorQueue<T> {
  private _promise: Promise<{ type: "done" } | { type: "value", value: T }>;
  private _resolve: undefined | ((val: { type: "done" } | { type: "value", value: T }) => void);

  constructor() {
    this._promise = new Promise((resolve) => {
      this._resolve = resolve;
    });
  }

  push(item: T) {
    this._resolve!({ type: "value", value: item });
  }

  finish() {
    this._resolve!({ type: "done" });
  }

  wrapPromise<P>(p: Promise<P>): Promise<P> {
    p.then(() => this.finish());
    return p;
  }

  items() {
    const that = this;
    async function* items() {
      while(true) {
        const val = await that._promise;
        if(val.type === "done") return;
        yield val.value;
        that._promise = new Promise((resolve) => {
          that._resolve = resolve;
        });
      }
    }
    return items();
  }
}
