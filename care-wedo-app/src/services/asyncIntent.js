const NO_PENDING_INTENT = Symbol("no-pending-intent");

export function createLatestIntentQueue(runIntent, { onError } = {}) {
  if (typeof runIntent !== "function") {
    throw new TypeError("runIntent must be a function");
  }

  let pendingIntent = NO_PENDING_INTENT;
  let runner = null;
  let idleWaiters = [];

  function resolveIdleWaiters() {
    const waiters = idleWaiters;
    idleWaiters = [];
    waiters.forEach((resolve) => resolve());
  }

  async function drain() {
    while (pendingIntent !== NO_PENDING_INTENT) {
      const intent = pendingIntent;
      pendingIntent = NO_PENDING_INTENT;
      try {
        await runIntent(intent);
      } catch (error) {
        onError?.(error, intent);
      }
    }
  }

  function start() {
    if (runner) return;
    runner = drain().finally(() => {
      runner = null;
      if (pendingIntent !== NO_PENDING_INTENT) {
        start();
        return;
      }
      resolveIdleWaiters();
    });
  }

  return {
    push(intent) {
      pendingIntent = intent;
      start();
    },
    whenIdle() {
      if (!runner && pendingIntent === NO_PENDING_INTENT) return Promise.resolve();
      return new Promise((resolve) => idleWaiters.push(resolve));
    },
  };
}

export function createLatestRequestGate() {
  let currentRequestId = 0;

  return {
    begin() {
      currentRequestId += 1;
      return currentRequestId;
    },
    invalidate() {
      currentRequestId += 1;
    },
    isCurrent(requestId) {
      return requestId === currentRequestId;
    },
  };
}

export function createRetryKeyStore(createKey = () => globalThis.crypto?.randomUUID?.() || `care-${Date.now()}-${Math.random().toString(36).slice(2)}`) {
  const keysByScope = new Map();

  return {
    get(scope) {
      if (!keysByScope.has(scope)) keysByScope.set(scope, createKey());
      return keysByScope.get(scope);
    },
    clear(scope, expectedKey) {
      if (expectedKey !== undefined && keysByScope.get(scope) !== expectedKey) return;
      keysByScope.delete(scope);
    },
  };
}
