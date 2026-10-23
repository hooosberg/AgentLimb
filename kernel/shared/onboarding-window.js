/**
 * The copy-prompt authorization window.
 *
 * Clicking "Copy connection prompt" is the user's authorization gesture. It
 * opens a short window during which the *next unknown* AI client is trusted
 * automatically — no confirmation page, no code to paste into a config, and no
 * restart when the window has to be reopened.
 *
 * Two properties matter:
 *   - consume() is one-shot: a single Copy authorizes a single new client, so
 *     a second AI cannot inherit the first one's authorization.
 *   - it is plain storage, not a secret. Nothing derived from it travels over
 *     the wire, so an expired window never leaves a client stuck with a stale
 *     code baked into its MCP config.
 */
import { ONBOARD_WINDOW_MS, STORAGE_KEYS } from './constants.js';

export function createOnboardingWindow(storage, now = () => Date.now()) {
  // SSE frames and rapid clicks can race; serialize so one window grants once.
  let chain = Promise.resolve();
  function serialize(action) {
    const result = chain.then(action);
    chain = result.catch(() => {});
    return result;
  }
  const readUntil = async () => (await storage.get(STORAGE_KEYS.onboardUntil))[STORAGE_KEYS.onboardUntil];

  return {
    open: () => serialize(async () => {
      const expiresAt = now() + ONBOARD_WINDOW_MS;
      await storage.set({ [STORAGE_KEYS.onboardUntil]: expiresAt });
      return { expiresAt };
    }),
    consume: () => serialize(async () => {
      const expiresAt = await readUntil();
      if (!Number.isFinite(expiresAt) || expiresAt <= now()) return false;
      await storage.set({ [STORAGE_KEYS.onboardUntil]: 0 });
      return true;
    }),
    close: () => serialize(async () => {
      await storage.set({ [STORAGE_KEYS.onboardUntil]: 0 });
    }),
  };
}
