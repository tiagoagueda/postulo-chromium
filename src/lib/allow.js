// Firefox accepts permissions.request only while it is still handling the click, which ends
// at the first await: so the request starts first, with nothing awaited before it.

/** Ask for the permission and keep the work, both started in this tick from the click, so a
 *  refused or interrupted prompt never costs what was captured. `ask` is null when nothing
 *  needs asking. Resolves to what `keep` returned; a prompt that fails counts as refused. */
export async function askAndKeep(ask, keep) {
  let asking = Promise.resolve(true);
  if (ask) {
    try {
      asking = Promise.resolve(ask()).catch(() => false);
    } catch {
      asking = Promise.resolve(false);
    }
  }
  const kept = keep();
  const [, value] = await Promise.allSettled([asking, kept]).then(() => Promise.all([asking, kept]));
  return value;
}
