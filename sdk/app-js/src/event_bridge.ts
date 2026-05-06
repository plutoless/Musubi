import { normalizeMusubiError } from "./errors.ts";
import type { Invocation } from "./invocation.ts";
import type { InvocationEvent } from "./types.ts";

export interface MusubiEventBridge<TEvent = unknown, TResult = unknown> {
  start(): void;
  stop(): void;
  readonly running: boolean;
}

export function createMusubiEventBridge<TEvent = unknown, TResult = unknown>(options: {
  invocation: Invocation;
  onEvent?: (event: InvocationEvent<TEvent>) => void | Promise<void>;
  onResult?: (result: TResult, event: InvocationEvent<TResult>) => void | Promise<void>;
  onError?: (error: Error) => void | Promise<void>;
}): MusubiEventBridge<TEvent, TResult> {
  const controller = new AbortController();
  let started = false;

  return {
    get running() {
      return started && !controller.signal.aborted;
    },
    start() {
      if (started) return;
      started = true;
      void (async () => {
        try {
          let finalEvent: InvocationEvent<TResult> | undefined;
          for await (const event of options.invocation.events<TEvent | TResult>({ signal: controller.signal })) {
            if (event.status === "completed") finalEvent = event as InvocationEvent<TResult>;
            await options.onEvent?.(event as InvocationEvent<TEvent>);
          }
          if (finalEvent) {
            await options.onResult?.(finalEvent.payload, finalEvent);
          }
        } catch (error) {
          await options.onError?.(normalizeMusubiError(error));
        }
      })();
    },
    stop() {
      controller.abort();
    },
  };
}
