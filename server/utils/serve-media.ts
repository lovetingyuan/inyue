import {
  getRequestHeader,
  removeResponseHeader,
  sendNoContent,
  sendStream,
  setResponseHeader,
  setResponseHeaders,
  setResponseStatus,
} from "h3";
import type { H3Event } from "h3";
import { mediaRange } from "./media-range";
import type { MediaBucket } from "../types/integration-media";

export async function serveMedia(
  event: H3Event,
  bucket: MediaBucket,
  key: string,
  contentType: string,
  knownSize?: number,
) {
  const header = getRequestHeader(event, "range");
  if (event.method !== "HEAD" && !header && knownSize === undefined) {
    const body = await bucket.get(key, {});
    if (!body) {
      return sendNoContent(event, 404);
    }
    setResponseHeaders(event, {
      "content-type": contentType,
      "accept-ranges": "bytes",
      "x-content-type-options": "nosniff",
      "content-length": body.size,
    });
    return sendStream(event, body.body);
  }
  let size: number;
  if (event.method !== "HEAD" && knownSize !== undefined) {
    size = knownSize;
  } else {
    const object = await bucket.head(key);
    if (!object) {
      return sendNoContent(event, 404);
    }
    size = object.size;
  }
  setResponseHeaders(event, {
    "content-type": contentType,
    "accept-ranges": "bytes",
    "x-content-type-options": "nosniff",
  });
  const range = header ? mediaRange(header, size) : undefined;
  if (range === null) {
    setResponseHeader(event, "content-range", `bytes */${size}`);
    return sendNoContent(event, 416);
  }
  setResponseHeader(event, "content-length", range?.length ?? size);
  if (range) {
    setResponseStatus(event, 206);
    setResponseHeader(
      event,
      "content-range",
      `bytes ${range.offset}-${range.offset + range.length - 1}/${size}`,
    );
  }
  if (event.method === "HEAD") {
    setResponseHeader(event, "x-music-content-length", range?.length ?? size);
    return sendNoContent(event, range ? 206 : 200);
  }
  const body = await bucket.get(key, { range });
  if (!body) {
    removeResponseHeader(event, "content-length");
    removeResponseHeader(event, "content-type");
    removeResponseHeader(event, "content-range");
    return sendNoContent(event, 404);
  }
  return sendStream(event, body.body);
}
