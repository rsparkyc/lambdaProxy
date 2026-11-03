// BSF CORS proxy. Dependency-free (Node 22 built-in fetch + zlib) to keep
// cold starts small. Behavior intentionally matches the previous superagent
// version, including its quirks, because the web app's login flow relies on them:
//   - redirects are not followed; a 302 is returned as 200 with its location header
//   - Set-Cookie values are exposed as `x-c-data: [cookie1, cookie2]`
//   - an `x-c-data` request header (JSON array of cookies) becomes a Cookie header
//   - non-JSON POST data is sent as the URL query string, with an empty body
//   - any other non-2xx upstream status becomes a 500 with `errorObj`
// New: responses are gzip-compressed when the client accepts it.

const zlib = require("zlib");

const STRIPPED_RESPONSE_HEADERS = new Set([
  "access-control-allow-origin",
  "access-control-allow-credentials",
  "access-control-allow-headers",
  "content-encoding", // fetch already decoded the body
  "content-length",
  "transfer-encoding",
  "connection",
  "set-cookie", // exposed via x-c-data instead
]);

const MIN_COMPRESS_BYTES = 1024;

exports.handler = async (event) => {
  if (event.requestContext.http.method.toLowerCase() === "options") {
    return { statusCode: 200 };
  }

  let eventData = event.body;
  if (event.isBase64Encoded && typeof eventData === "string") {
    eventData = Buffer.from(eventData, "base64").toString("utf8");
  }
  if (typeof eventData === "string") {
    eventData = JSON.parse(eventData);
  }

  let url = eventData?.url;
  if (!url) {
    url = event.queryStringParameters?.url;
    if (!url) {
      return { statusCode: 400, body: JSON.stringify({ error: "Missing URL parameter" }) };
    }
    eventData = { url, method: "get" };
  }

  const method = (eventData.method || "get").toUpperCase();
  if (method !== "GET" && method !== "POST") {
    console.error("No methods matched");
    return { statusCode: 400, body: JSON.stringify({ error: "Unsupported method" }) };
  }

  const headers = buildRequestHeaders(eventData.headers);
  const init = { method, headers, redirect: "manual" };

  if (method === "POST" && eventData.data != null) {
    const isJson = Object.entries(headers).some(
      ([k, v]) => k.toLowerCase() === "content-type" && String(v).toLowerCase().includes("json")
    );
    if (isJson) {
      init.body = typeof eventData.data === "string" ? eventData.data : JSON.stringify(eventData.data);
    } else {
      url = appendQuery(url, eventData.data);
    }
  }

  let response;
  try {
    response = await fetch(url, init);
  } catch (error) {
    console.error("Fetch error:", error.message);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: "Internal Server Error", errorObj: { message: error.message } }),
    };
  }

  const ok = (response.status >= 200 && response.status < 300) || response.status === 302;
  const text = await response.text();

  if (!ok) {
    return {
      statusCode: 500,
      body: JSON.stringify({
        error: "Internal Server Error",
        errorObj: { status: response.status, response: { text } },
      }),
    };
  }

  return buildResponse(response, text, event.headers || {});
};

function buildRequestHeaders(input) {
  const headers = {};
  if (!input) return headers;
  for (const key of Object.keys(input)) {
    if (key === "x-c-data") {
      headers.Cookie = JSON.parse(input[key]).join(";");
    } else {
      headers[key] = input[key];
    }
  }
  return headers;
}

function appendQuery(url, data) {
  const qs = typeof data === "string" ? data : new URLSearchParams(data).toString();
  if (!qs) return url;
  return url + (url.includes("?") ? "&" : "?") + qs;
}

function buildResponse(response, text, requestHeaders) {
  const headers = {};
  for (const [key, value] of response.headers) {
    if (!STRIPPED_RESPONSE_HEADERS.has(key)) headers[key] = value;
  }

  const cookies = response.headers.getSetCookie();
  if (cookies.length > 0) {
    // Same format Lambda produced for the old array-valued header.
    headers["x-c-data"] = `[${cookies.join(", ")}]`;
  }

  if (headers["content-disposition"]) {
    headers["content-disposition"] = headers["content-disposition"].replace("attachment", "inline");
  }

  // Let the browser follow nothing; the client reads the location header.
  const statusCode = response.status === 302 ? 200 : response.status;

  const acceptEncoding = String(requestHeaders["accept-encoding"] || "");
  if (/\bgzip\b/.test(acceptEncoding) && Buffer.byteLength(text) >= MIN_COMPRESS_BYTES) {
    headers["content-encoding"] = "gzip";
    headers["vary"] = "accept-encoding";
    return {
      statusCode,
      headers,
      body: zlib.gzipSync(text, { level: 6 }).toString("base64"),
      isBase64Encoded: true,
    };
  }

  return { statusCode, headers, body: text };
}
