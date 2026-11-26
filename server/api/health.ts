import { createError, defineEventHandler, sendNoContent, setResponseHeader } from "h3";

export default defineEventHandler((event) => {
  if (event.method !== "GET" && event.method !== "HEAD") {
    throw createError({ statusCode: 405, statusMessage: "Method Not Allowed" });
  }
  setResponseHeader(event, "cache-control", "private, no-store");
  return sendNoContent(event);
});
