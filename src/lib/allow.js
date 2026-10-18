// Firefox accepts permissions.request only while it is still handling the click, which ends
// at the first await: so the request starts first, with nothing awaited before it.

/** Ask for the permission and keep the work, both started in this tick from the click, so a
 *  refused or interrupted prompt never costs what was captured. `ask` is null when nothing
 *  needs asking; `refused`, when given, is called once a refused prompt is known. Resolves to what `keep` returned; a prompt that fails counts as refused. */
export async function askAndKeep(ask, keep, refused = null) {
  let asking = Promise.resolve(true);
  if (ask) {
    try {
      asking = Promise.resolve(ask()).catch(() => false);
    } catch {
      asking = Promise.resolve(false);
    }
  }
  const kept = keep();
  const [granted, value] = await Promise.allSettled([asking, kept]).then(() => Promise.all([asking, kept]));
  // Said by the caller once it has finished: a capture that waits for a permission the person
  // refused would otherwise sit there with nothing to say why (#28).
  if (ask && granted === false && refused) {
    refused();
  }
  return value;
}
