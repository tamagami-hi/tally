import { AsyncLocalStorage } from "node:async_hooks";

interface Call {
  writes: boolean;
}

const calling = new AsyncLocalStorage<Call>();

export const asCall = <T>(writes: boolean, body: () => T): T => calling.run({ writes }, body);

export const isWriting = (): boolean => calling.getStore()?.writes ?? true;
