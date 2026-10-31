const http = require("http");
const fs = require("fs");
const path = require("path");

const root = __dirname;
const dataDir = path.join(root, "data");
const dataFile = path.join(dataDir, "ranking.json");
const maxEntries = 100;
const port = 3000;
const namePattern = /^[A-Za-z0-9]{1,4}$/;

const types = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".png": "image/png",
  ".csv": "text/csv; charset=utf-8"
};

let chain = Promise.resolve();

function enqueue(work) {
  const run = chain.then(work, work);
  chain = run.then(function () {}, function () {});
  return run;
}

function ensureStore() {
  fs.mkdirSync(dataDir, { recursive: true });
  if (!fs.existsSync(dataFile)) {
    fs.writeFileSync(dataFile, "[]\n");
  }
}

function readRanking() {
  const data = JSON.parse(fs.readFileSync(dataFile, "utf8"));
  if (!Array.isArray(data)) {
    return [];
  }
  return data;
}

function writeRanking(entries) {
  fs.writeFileSync(dataFile, JSON.stringify(entries, null, 2) + "\n");
}

function byRank(a, b) {
  if (b.score !== a.score) {
    return b.score - a.score;
  }
  return a.at - b.at;
}

function ordered(entries) {
  return entries.slice().sort(byRank);
}

function rankOf(entries, score, at) {
  let above = 0;
  for (const entry of entries) {
    if (entry.score > score || (entry.score === score && entry.at <= at)) {
      above += 1;
    }
  }
  return above + 1;
}

function publicEntries(entries) {
  return ordered(entries).map(function (entry, index) {
    return {
      rank: index + 1,
      name: entry.name,
      score: entry.score
    };
  });
}

function validName(name) {
  return typeof name === "string" && namePattern.test(name);
}

function validScore(score) {
  return Number.isSafeInteger(score) && score >= 0;
}

function sendJson(response, status, body) {
  const payload = JSON.stringify(body);
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(payload)
  });
  response.end(payload);
}

function readBody(request) {
  return new Promise(function (resolve, reject) {
    const chunks = [];
    let size = 0;
    let failed = false;
    request.on("data", function (chunk) {
      if (failed) {
        return;
      }
      size += chunk.length;
      if (size > 1024) {
        failed = true;
        reject(new Error("too large"));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", function () {
      if (!failed) {
        resolve(Buffer.concat(chunks).toString("utf8"));
      }
    });
    request.on("error", function (error) {
      if (!failed) {
        failed = true;
        reject(error);
      }
    });
  });
}

function snapshot(entries, score) {
  const body = { entries: publicEntries(entries) };
  if (score === undefined) {
    return body;
  }
  const rank = rankOf(entries, score, Date.now());
  if (rank <= maxEntries) {
    body.rank = rank;
    body.eligible = true;
  } else {
    body.rank = null;
    body.eligible = false;
  }
  return body;
}

function handleRankingGet(requestUrl, response) {
  const scoreText = requestUrl.searchParams.get("score");
  let score;
  if (scoreText !== null) {
    if (!/^\d+$/.test(scoreText)) {
      sendJson(response, 400, { error: "invalid score" });
      return;
    }
    score = Number(scoreText);
    if (!validScore(score)) {
      sendJson(response, 400, { error: "invalid score" });
      return;
    }
  }
  enqueue(function () {
    try {
      sendJson(response, 200, snapshot(readRanking(), score));
    } catch (error) {
      if (!response.headersSent) {
        sendJson(response, 500, { error: "failed" });
      }
    }
  });
}

function handleRankingPost(request, response) {
  readBody(request).then(function (text) {
    let body;
    try {
      body = JSON.parse(text);
    } catch (error) {
      sendJson(response, 400, { error: "invalid json" });
      return;
    }
    if (!body || !validName(body.name) || !validScore(body.score)) {
      sendJson(response, 400, { error: "invalid" });
      return;
    }
    const name = body.name;
    const score = body.score;
    return enqueue(function () {
      try {
        const entries = readRanking();
        const at = Date.now();
        const rank = rankOf(entries, score, at);
        if (rank > maxEntries) {
          sendJson(response, 200, {
            accepted: false,
            rank: null,
            eligible: false
          });
          return;
        }
        const next = entries.concat([{ name: name, score: score, at: at }]);
        next.sort(byRank);
        const kept = next.slice(0, maxEntries);
        writeRanking(kept);
        sendJson(response, 200, {
          accepted: true,
          rank: rank,
          entries: publicEntries(kept)
        });
      } catch (error) {
        if (!response.headersSent) {
          sendJson(response, 500, { error: "failed" });
        }
      }
    });
  }).catch(function () {
    if (!response.headersSent) {
      sendJson(response, 400, { error: "invalid" });
    }
  });
}

function safeFile(requestPath) {
  let decoded;
  try {
    decoded = decodeURIComponent(requestPath);
  } catch (error) {
    return null;
  }
  const relative = decoded === "/" ? "index.html" : decoded.replace(/^\/+/, "");
  if (relative.includes("\0")) {
    return null;
  }
  const full = path.resolve(root, relative);
  const rootPrefix = root.endsWith(path.sep) ? root : root + path.sep;
  if (full !== root && !full.startsWith(rootPrefix)) {
    return null;
  }
  const dataPrefix = dataDir.endsWith(path.sep) ? dataDir : dataDir + path.sep;
  if (full === dataDir || full.startsWith(dataPrefix)) {
    return null;
  }
  return full;
}

function serveFile(requestPath, response) {
  const full = safeFile(requestPath);
  if (!full) {
    response.writeHead(403);
    response.end();
    return;
  }
  let stat;
  try {
    stat = fs.statSync(full);
  } catch (error) {
    response.writeHead(404);
    response.end();
    return;
  }
  if (!stat.isFile()) {
    response.writeHead(404);
    response.end();
    return;
  }
  const type = types[path.extname(full).toLowerCase()] || "application/octet-stream";
  response.writeHead(200, {
    "Content-Type": type,
    "Cache-Control": "no-cache"
  });
  fs.createReadStream(full).pipe(response);
}

ensureStore();

const server = http.createServer(function (request, response) {
  const requestUrl = new URL(request.url, "http://localhost");
  if (requestUrl.pathname === "/api/ranking" && request.method === "GET") {
    handleRankingGet(requestUrl, response);
    return;
  }
  if (requestUrl.pathname === "/api/ranking" && request.method === "POST") {
    handleRankingPost(request, response);
    return;
  }
  if (request.method !== "GET" && request.method !== "HEAD") {
    response.writeHead(405);
    response.end();
    return;
  }
  serveFile(requestUrl.pathname, response);
});

server.on("error", function (error) {
  console.error(error.message);
  process.exit(1);
});

server.listen(port, function () {
  console.log("http://localhost:" + port + "/");
});
