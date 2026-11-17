export class RenderError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "RenderError";
  }
}
export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
