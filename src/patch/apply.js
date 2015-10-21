import {parsePatch} from './parse';

export function applyPatch(source, uniDiff, options = {}) {
  if (typeof uniDiff === 'string') {
    uniDiff = parsePatch(uniDiff);
  }

  if (Array.isArray(uniDiff)) {
    if (uniDiff.length > 1) {
      throw new Error('applyPatch only works with a single input.');
    }

    uniDiff = uniDiff[0];
  }

  // Apply the diff to the input
  let lines = source.split('\n'),
      hunks = uniDiff.hunks,

      compareLine = options.compareLine || ((lineNumber, line, operation, patchContent) => line === patchContent),
      errorCount = 0,
      fuzzFactor = options.fuzzFactor || 0,
      minLine = 0,
      offset = 0,

      removeEOFNL,
      addEOFNL;

  /**
   * Checks if the hunk exactly fits on the provided location
   */
  function hunkFits(hunk, toPos) {
    for (let j = 0; j < hunk.lines.length; j++) {
      let line = hunk.lines[j],
          operation = line[0],
          content = line.substr(1);

      if (operation === ' ' || operation === '-') {
        // Context sanity check
        if (!compareLine(toPos + 1, lines[toPos], operation, content)) {
          errorCount++;

          if (errorCount > fuzzFactor) {
            return false;
          }
        }
        toPos++;
      }
    }

    return true;
  }

  // Search best fit offsets for each hunk based on the previous ones
  for (let i = 0; i < hunks.length; i++) {
    let hunk = hunks[i],
        outOfLimits = 0,
        localOffset = 0,
        toPos = offset + hunk.oldStart - 1;

    for (;;) {
      // Check if trying to fit beyond text length, and if not, check it fits
      // after offset location (or desired location on first iteration)
      if (lines.length < toPos + localOffset + hunk.oldLines) {
        outOfLimits++;
      } else if (hunkFits(hunk, toPos + localOffset)) {
        hunk.offset = offset += localOffset;
        break;
      }

      // If we tried to fit hunk before text beginning and beyond text lenght,
      // then hunk can't be fit on the text so we raise an error
      if (outOfLimits === 2) {
        return false;
      }

      // Reset checks of trying to fit outside text limits and increase offset
      // of the current hunk relative to its desired location
      outOfLimits = 0;
      localOffset++;

      // Check if trying to fit before text beginning, and if not, check it fits
      // before offset location
      if (toPos - localOffset < minLine) {
        outOfLimits++;
      } else if (hunkFits(hunk, toPos - localOffset)) {
        hunk.offset = offset -= localOffset;
        break;
      }
    }

    // Set lower text limit to end of the current hunk, so next ones don't try
    // to fit over already patched text
    minLine = hunk.offset + hunk.oldStart + hunk.oldLines;
  }

  // Apply patch hunks
  for (let i = 0; i < hunks.length; i++) {
    let hunk = hunks[i],
        toPos = hunk.offset + hunk.newStart - 1;

    for (let j = 0; j < hunk.lines.length; j++) {
      let line = hunk.lines[j],
          operation = line[0],
          content = line.substr(1);

      if (operation === ' ') {
        toPos++;
      } else if (operation === '-') {
        lines.splice(toPos, 1);
      /* istanbul ignore else */
      } else if (operation === '+') {
        lines.splice(toPos, 0, content);
        toPos++;
      } else if (operation === '\\') {
        let previousOperation = hunk.lines[j - 1] ? hunk.lines[j - 1][0] : null;
        if (previousOperation === '+') {
          removeEOFNL = true;
        } else if (previousOperation === '-') {
          addEOFNL = true;
        }
      }
    }
  }

  // Handle EOFNL insertion/removal
  if (removeEOFNL) {
    while (!lines[lines.length - 1]) {
      lines.pop();
    }
  } else if (addEOFNL) {
    lines.push('');
  }
  return lines.join('\n');
}

// Wrapper that supports multiple file patches via callbacks.
export function applyPatches(uniDiff, options) {
  if (typeof uniDiff === 'string') {
    uniDiff = parsePatch(uniDiff);
  }

  let currentIndex = 0;
  function processIndex() {
    let index = uniDiff[currentIndex++];
    if (!index) {
      return options.complete();
    }

    options.loadFile(index, function(err, data) {
      if (err) {
        return options.complete(err);
      }

      let updatedContent = applyPatch(data, index, options);
      options.patched(index, updatedContent);

      setTimeout(processIndex, 0);
    });
  }
  processIndex();
}
