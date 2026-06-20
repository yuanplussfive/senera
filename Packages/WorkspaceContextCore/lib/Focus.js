"use strict";

function focusFromIndices({ target, query, value, indices }) {
  const normalized = normalizeIndices(indices, value.length);
  const spans = spansFromIndices(value, normalized);
  return createFocus({ target, query, value, indices: normalized, spans });
}

function focusFromByteRanges({ target, query, value, ranges }) {
  const spans = [];
  const indices = [];
  for (const range of ranges) {
    const start = byteOffsetToStringIndex(value, range.start);
    const end = byteOffsetToStringIndex(value, range.end);
    if (start >= end) {
      continue;
    }
    spans.push({
      start,
      end,
      text: value.slice(start, end)
    });
    for (let index = start; index < end; index += 1) {
      indices.push(index);
    }
  }
  return createFocus({
    target,
    query,
    value,
    indices: normalizeIndices(indices, value.length),
    spans
  });
}

function createFocus({ target, query, value, indices, spans }) {
  const matchedText = spans.map((span) => span.text).join(" ");
  const summary = [target, matchedText].filter(Boolean).join(": ");
  return {
    target,
    query,
    value,
    matchedText,
    indices: {
      item: indices
    },
    spans: {
      item: spans
    },
    summary
  };
}

function normalizeIndices(indices, length) {
  return [...new Set(indices)]
    .map((index) => Number(index))
    .filter((index) => Number.isInteger(index) && index >= 0 && index < length)
    .sort((left, right) => left - right);
}

function spansFromIndices(value, indices) {
  const spans = [];
  let spanStart;
  let previous;

  for (const index of indices) {
    if (spanStart === undefined) {
      spanStart = index;
      previous = index;
      continue;
    }
    if (index === previous + 1) {
      previous = index;
      continue;
    }
    spans.push(spanFromRange(value, spanStart, previous + 1));
    spanStart = index;
    previous = index;
  }

  if (spanStart !== undefined) {
    spans.push(spanFromRange(value, spanStart, previous + 1));
  }

  return spans;
}

function spanFromRange(value, start, end) {
  return {
    start,
    end,
    text: value.slice(start, end)
  };
}

function byteOffsetToStringIndex(value, byteOffset) {
  return Buffer.from(value, "utf8").subarray(0, byteOffset).toString("utf8").length;
}

function focusList(...items) {
  const focusItems = items.flatMap((item) => {
    if (!item) {
      return [];
    }
    if (Array.isArray(item.item)) {
      return item.item;
    }
    if (typeof item === "object" && typeof item.target === "string") {
      return [item];
    }
    return [];
  });
  if (focusItems.length === 0) {
    return undefined;
  }
  return {
    item: focusItems
  };
}

function focusSummary(focus) {
  const summary = (focus?.item ?? [])
    .map((item) => item.summary)
    .filter(Boolean)
    .join("; ");
  return summary || undefined;
}

module.exports = {
  focusFromByteRanges,
  focusFromIndices,
  focusList,
  focusSummary
};
