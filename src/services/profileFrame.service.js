const prisma = require('../config/prisma');
const input = require('../utils/input');

// Resolve both selectors through the catalog; a URL must never bypass ownership.
async function resolveProfileFrame(data, userId = null) {
  const result = {};
  if (data.frameColor !== undefined)
    result.frameColor = input.optionalText(data.frameColor, 'frameColor');
  const hasId = data.frameId !== undefined;
  const hasUrl = data.frameUrl !== undefined;
  const frameId = hasId ? input.optionalText(data.frameId, 'frameId') : null;
  const frameUrl = hasUrl ? input.optionalText(data.frameUrl, 'frameUrl') : null;

  if (!frameId && !frameUrl) {
    // Clearing the image must also clear its ID, otherwise the client reloads it.
    if (hasId || hasUrl) Object.assign(result, { frameId: null, frameUrl: null });
    return result;
  }

  let frame;
  if (frameId) {
    frame = await prisma.frame.findUnique({ where: { id: frameId } });
    if (!frame) input.fail('Frame not found', 404);
    if (frameUrl && frameUrl !== frame.imageUrl)
      input.fail('frameUrl does not match frameId');
  } else {
    const matches = await prisma.frame.findMany({ where: { imageUrl: frameUrl }, take: 2 });
    if (!matches.length) input.fail('Frame not found for frameUrl', 404);
    if (matches.length > 1)
      input.fail('frameUrl matches multiple frames; provide frameId');
    [frame] = matches;
  }

  if (frame.price > 0) {
    const owned = userId !== null && await prisma.userFrame.findUnique({
      where: { userId_frameId: { userId, frameId: frame.id } },
    });
    if (!owned) input.fail(userId === null
      ? 'Purchase this frame after signing in'
      : 'Purchase this frame first', 403);
  }

  return { frameId: frame.id, frameColor: frame.color, frameUrl: frame.imageUrl ?? null };
}

module.exports = { resolveProfileFrame };
