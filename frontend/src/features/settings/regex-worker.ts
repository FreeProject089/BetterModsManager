// The worker regex-budget.ts runs user-supplied patterns in. It does one thing: answer each
// request with runRegexOp. If a pattern never finishes, the page terminates this worker — which
// is the whole point of running it here and not on the UI thread.
import { runRegexOp, type RegexReq } from './regex-op.js';

const scope = self as unknown as { onmessage: ((e: { data: RegexReq }) => void) | null; postMessage(m: unknown): void };
scope.onmessage = (e) => { scope.postMessage(runRegexOp(e.data)); };
