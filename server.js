const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = __dirname;
const PORT = Number(process.env.PORT || 3000);

function loadEnvFile() {
  const file = path.join(ROOT, ".env");
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!match || Object.prototype.hasOwnProperty.call(process.env, match[1])) continue;
    let value = match[2];
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    process.env[match[1]] = value;
  }
}
loadEnvFile();

function json(res, status, data) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
  res.end(JSON.stringify(data));
}
function requiredEnv(name, label) {
  const value = process.env[name];
  if (!value || !value.trim()) {
    const error = new Error(label + " 인증키가 서버에 설정되지 않았습니다. 환경변수 " + name + "을 설정하세요.");
    error.status = 503;
    throw error;
  }
  return value.trim();
}
async function requestJson(url, serviceName) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  try {
    const response = await fetch(url, { headers: { "Accept": "application/json" }, signal: controller.signal });
    const body = await response.text();
    let data;
    try { data = JSON.parse(body); }
    catch {
      const error = new Error(serviceName + " 응답을 JSON으로 해석하지 못했습니다. API 인증·요청값·응답 형식을 확인하세요.");
      error.status = 502;
      throw error;
    }
    if (!response.ok) {
      const error = new Error(serviceName + " 요청 실패 (HTTP " + response.status + "). 활용 승인과 요청값을 확인하세요.");
      error.status = 502;
      throw error;
    }
    return data;
  } catch (error) {
    if (error.name === "AbortError") {
      const timeoutError = new Error(serviceName + " 응답 시간이 초과되었습니다. 잠시 후 다시 시도하세요.");
      timeoutError.status = 504;
      throw timeoutError;
    }
    throw error;
  } finally { clearTimeout(timer); }
}
function integerParam(search, name, min, max) {
  const raw = search.get(name);
  if (raw === null || !/^\d+$/.test(raw)) return null;
  const value = Number(raw);
  return Number.isSafeInteger(value) && value >= min && value <= max ? value : null;
}
async function handleApi(req, res, url) {
  if (url.pathname === "/api/health") {
    return json(res, 200, {
      ok: true,
      dataGoKrConfigured: Boolean(process.env.DATA_GO_KR_SERVICE_KEY),
      kosisConfigured: Boolean(process.env.KOSIS_API_KEY)
    });
  }
  if (url.pathname === "/api/youth-survey") {
    const key = requiredEnv("DATA_GO_KR_SERVICE_KEY", "공공데이터포털");
    const year = integerParam(url.searchParams, "year", 2000, 2100);
    const targetSn = integerParam(url.searchParams, "targetSn", 1, 999);
    const itemSn = integerParam(url.searchParams, "itemSn", 1, 999);
    if (!year || !targetSn || !itemSn) return json(res, 400, { error: "조사 연도, 대상 일련번호, 항목 번호를 올바르게 입력하세요." });
    const apiUrl = new URL("https://apis.data.go.kr/1383000/stis/srvyTeenOvrlMcrDataService/getServeyTeenOverallDataList");
    apiUrl.search = new URLSearchParams({
      ServiceKey: key, pageNo: "1", numOfRows: "100", type: "json",
      fctExmnYr: String(year), fctExmnTrgtSn: String(targetSn), fctExmnItmSn: String(itemSn)
    }).toString();
    const data = await requestJson(apiUrl, "청소년종합실태조사 API");
    return json(res, 200, data);
  }
  if (url.pathname === "/api/kosis-statistics") {
    const key = requiredEnv("KOSIS_API_KEY", "KOSIS");
    const orgId = (url.searchParams.get("orgId") || "").trim();
    const tblId = (url.searchParams.get("tblId") || "").trim();
    const itmId = (url.searchParams.get("itmId") || "").trim();
    const objL1 = (url.searchParams.get("objL1") || "").trim();
    const start = url.searchParams.get("startPrdDe") || "";
    const end = url.searchParams.get("endPrdDe") || "";
    if (!orgId || !tblId || !itmId || !objL1 || !/^\d{4}$/.test(start) || !/^\d{4}$/.test(end) || Number(start) > Number(end)) {
      return json(res, 400, { error: "기관 ID, 통계표 ID, 항목 ID, 분류 ID(objL1), 올바른 시작·종료 연도를 입력하세요." });
    }
    const apiUrl = new URL("https://kosis.kr/openapi/Param/statisticsParameterData.do");
    apiUrl.search = new URLSearchParams({
      method: "getList", apiKey: key, orgId, tblId, objL1, itmId,
      prdSe: "Y", startPrdDe: start, endPrdDe: end, format: "json"
    }).toString();
    const data = await requestJson(apiUrl, "KOSIS 통계 API");
    return json(res, 200, data);
  }
  return json(res, 404, { error: "API 경로를 찾을 수 없습니다." });
}

const mimeTypes = {
  ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8", ".json": "application/json; charset=utf-8",
  ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml", ".ico": "image/x-icon"
};
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://" + (req.headers.host || "localhost"));
    if (url.pathname.startsWith("/api/")) {
      if (req.method !== "GET") return json(res, 405, { error: "GET 요청만 허용됩니다." });
      return await handleApi(req, res, url);
    }
    if (req.method !== "GET" && req.method !== "HEAD") {
      res.writeHead(405);
      return res.end("Method Not Allowed");
    }
    const requested = url.pathname === "/" ? "index.html" : decodeURIComponent(url.pathname).replace(/^\/+/, "");
    const filePath = path.resolve(ROOT, requested);
    if (filePath !== ROOT && !filePath.startsWith(ROOT + path.sep)) {
      res.writeHead(403);
      return res.end("Forbidden");
    }
    if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
      res.writeHead(404);
      return res.end("Not Found");
    }
    res.writeHead(200, { "Content-Type": mimeTypes[path.extname(filePath).toLowerCase()] || "application/octet-stream", "X-Content-Type-Options": "nosniff" });
    if (req.method === "HEAD") return res.end();
    fs.createReadStream(filePath).pipe(res);
  } catch (error) {
    const status = Number.isInteger(error.status) ? error.status : 500;
    return json(res, status, { error: error.message || "서버 내부 오류가 발생했습니다." });
  }
});
server.listen(PORT, "0.0.0.0", () => console.log("알바체크 AI 서버 실행 중: http://localhost:" + PORT));
