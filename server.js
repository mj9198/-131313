// AlbacCheck AI local API proxy - Node.js 18+
const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

function loadEnv() {
  const p = path.join(__dirname, '.env');
  if (!fs.existsSync(p)) return;
  for (const line of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
}
loadEnv();

const PORT = Number(process.env.PORT || 3000);
const YOUTH_KEY = process.env.DATA_GO_KR_SERVICE_KEY || '';
const KOSIS_KEY = process.env.KOSIS_API_KEY || '';

function json(res, status, body) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': 'same-origin',
    'X-Content-Type-Options': 'nosniff'
  });
  res.end(JSON.stringify(body));
}
function clean(s, max=100) {
  return String(s || '').trim().slice(0, max);
}
async function upstream(url) {
  const r = await fetch(url, { headers: { 'Accept': 'application/json' }, signal: AbortSignal.timeout(15000) });
  const text = await r.text();
  let data;
  try { data = JSON.parse(text); } catch { data = { rawText: text.slice(0, 10000) }; }
  if (!r.ok) {
    const msg = data?.message || data?.error || `외부 API HTTP ${r.status}`;
    throw new Error(msg);
  }
  // Data.go.kr sometimes returns JSON as an error string or XML even when JSON was requested.
  if (data?.response?.header?.resultCode && data.response.header.resultCode !== '00' && data.response.header.resultCode !== '0') {
    throw new Error(`공공데이터 API 오류 ${data.response.header.resultCode}: ${data.response.header.resultMsg || '응답 오류'}`);
  }
  return data;
}
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  if (req.method !== 'GET') return json(res, 405, { error: 'GET 요청만 지원합니다.' });

  if (url.pathname === '/api/health') {
    return json(res, 200, {
      ok: true,
      dataGoKrConfigured: Boolean(YOUTH_KEY),
      kosisConfigured: Boolean(KOSIS_KEY),
      note: '인증키 값은 브라우저에 전송하지 않습니다.'
    });
  }

  if (url.pathname === '/api/youth-survey') {
    if (!YOUTH_KEY) return json(res, 503, { error: 'DATA_GO_KR_SERVICE_KEY가 .env에 설정되지 않았습니다.' });
    const year = clean(url.searchParams.get('year'), 4);
    const targetSn = clean(url.searchParams.get('targetSn'), 3);
    const itemSn = clean(url.searchParams.get('itemSn'), 3);
    if (!/^\d{4}$/.test(year) || !/^\d{1,3}$/.test(targetSn) || !/^\d{1,3}$/.test(itemSn)) {
      return json(res, 400, { error: '연도·대상 번호·항목 번호 형식이 올바르지 않습니다.' });
    }
    const endpoint = new URL('https://apis.data.go.kr/1383000/stis/srvyTeenOvrlMcrDataService/getServeyTeenOverallDataList');
    endpoint.search = new URLSearchParams({
      serviceKey: YOUTH_KEY,
      pageNo: '1',
      numOfRows: '100',
      type: 'json',
      fctExmnYr: year,
      fctExmnTrgtSn: targetSn,
      fctExmnItmSn: itemSn
    }).toString();
    try {
      const data = await upstream(endpoint);
      return json(res, 200, {
        source: '성평등가족부 청소년종합실태조사 마이크로데이터 정보 서비스',
        sourceUrl: 'https://www.data.go.kr/data/15078212/openapi.do',
        queriedAt: new Date().toISOString(),
        query: { year, targetSn, itemSn },
        data
      });
    } catch (e) {
      return json(res, 502, { error: `청소년 API 호출 실패: ${e.message}` });
    }
  }

  if (url.pathname === '/api/kosis-statistics') {
    if (!KOSIS_KEY) return json(res, 503, { error: 'KOSIS_API_KEY가 .env에 설정되지 않았습니다.' });
    const orgId = clean(url.searchParams.get('orgId'), 30);
    const tblId = clean(url.searchParams.get('tblId'), 50);
    const itmId = clean(url.searchParams.get('itmId'), 100);
    const startPrdDe = clean(url.searchParams.get('startPrdDe'), 4);
    const endPrdDe = clean(url.searchParams.get('endPrdDe'), 4);
    const prdSe = clean(url.searchParams.get('prdSe') || 'Y', 1);
    const objL1 = clean(url.searchParams.get('objL1'), 100);
    if (!orgId || !tblId || !itmId || !/^\d{4}$/.test(startPrdDe) || !/^\d{4}$/.test(endPrdDe) || !['Y','Q','M','A'].includes(prdSe)) {
      return json(res, 400, { error: '기관 ID·통계표 ID·항목 ID·연도·주기를 확인하세요.' });
    }
    // KOSIS general statistics data API; API key stays on server.
    const endpoint = new URL('https://kosis.kr/openapi/Param/statisticsParameterData.do');
    const params = {
      method: 'getList',
      apiKey: KOSIS_KEY,
      orgId, tblId, itmId, prdSe, startPrdDe, endPrdDe,
      format: 'json',
      jsonVD: 'Y'
    };
    if (objL1) params.objL1 = objL1;
    endpoint.search = new URLSearchParams(params).toString();
    try {
      const data = await upstream(endpoint);
      return json(res, 200, {
        source: 'KOSIS 국가통계포털 공유서비스 통계자료 조회',
        sourceUrl: 'https://kosis.kr/openapi/index/index.jsp',
        queriedAt: new Date().toISOString(),
        query: { orgId, tblId, itmId, prdSe, startPrdDe, endPrdDe, objL1: objL1 || null },
        data
      });
    } catch (e) {
      return json(res, 502, { error: `KOSIS API 호출 실패: ${e.message}` });
    }
  }

  // Serve only files in this project directory.
  const rel = url.pathname === '/' ? 'albacheck_ai_api.html' : decodeURIComponent(url.pathname.slice(1));
  const resolved = path.resolve(__dirname, rel);
  if (!resolved.startsWith(path.resolve(__dirname) + path.sep) || !fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) {
    return json(res, 404, { error: '파일을 찾을 수 없습니다.' });
  }
  const ext = path.extname(resolved);
  const type = ext === '.html' ? 'text/html; charset=utf-8' : ext === '.css' ? 'text/css; charset=utf-8' : 'application/octet-stream';
  res.writeHead(200, { 'Content-Type': type, 'X-Content-Type-Options': 'nosniff' });
  fs.createReadStream(resolved).pipe(res);
});
server.listen(PORT, '127.0.0.1', () => {
  console.log(`알바체크 AI 서버 실행: http://localhost:${PORT}`);
  console.log(`청소년 API 키: ${YOUTH_KEY ? '설정됨' : '미설정'} / KOSIS 키: ${KOSIS_KEY ? '설정됨' : '미설정'}`);
});
