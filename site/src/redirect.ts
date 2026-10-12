/**
 * The old marketing site's address. The front page now lives in the app at
 * loop.goodone.si, so anything that still links here is sent there, path and
 * all.
 */
const TARGET = "https://loop.goodone.si";

export default {
  fetch(request: Request): Response {
    const url = new URL(request.url);
    return Response.redirect(`${TARGET}${url.pathname}${url.search}`, 301);
  },
};
