const stage = document.querySelector("#stage");
const message = document.querySelector("#message");
const nextName = document.querySelector("#next-name");
const nextImage = document.querySelector("#next-image");
const nextDescription = document.querySelector("#next-description");
const highScoreLabel = document.querySelector("#high-score");
const shareButton = document.querySelector("#share");
const registerPanel = document.querySelector("#register");
const registerNote = document.querySelector("#register-note");
const playerNameInput = document.querySelector("#player-name");
const rankingTrack = document.querySelector("#ranking-track");
const highScoreKey = "doubutsu-tower-high-score";
const rankingStorageKey = "doubutsu-tower-ranking";
const maxRankingEntries = 100;
const namePattern = /^[A-Za-z0-9]{1,4}$/;

const fallStartSpeed = 0.4;
const stopSpeed = 0.15;
const quarterTurn = Math.PI / 2;
const groundThickness = 20;
const loseMessage = "あなたの負けです";
const fullMessage = "枠がいっぱいになりました";
const fullBonus = 50;

let dragging = false;
let dropped = false;
let box = null;
let releaseBody = null;
let fallingStarted = false;
let lost = false;
const pieces = [];
let nextAnimal = null;
let highScore = savedHighScore();
let lastScore = 0;
let scoreBaseMessage = "";
let round = 0;
let registering = false;

function savedHighScore() {
  const saved = Number(localStorage.getItem(highScoreKey));
  if (Number.isNaN(saved)) {
    return 0;
  }
  return saved;
}

function showHighScore() {
  highScoreLabel.textContent = "最高スコア: " + highScore;
}

function keepHighScore(score) {
  if (score <= highScore) {
    return;
  }
  highScore = score;
  localStorage.setItem(highScoreKey, String(highScore));
  showHighScore();
}

function hideRegister() {
  registerPanel.hidden = true;
  registerNote.textContent = "";
  playerNameInput.value = "";
  registering = false;
}

function showRegister() {
  registerNote.textContent = "";
  playerNameInput.value = "";
  registerPanel.hidden = false;
  playerNameInput.focus();
}

function messageWithRank(rank) {
  if (rank) {
    return scoreBaseMessage + "　" + rank + "位";
  }
  return scoreBaseMessage + "　圏外";
}

function byRank(a, b) {
  if (b.score !== a.score) {
    return b.score - a.score;
  }
  return a.at - b.at;
}

function validRankingEntries(data) {
  if (!Array.isArray(data)) {
    return [];
  }
  return data.filter(function (entry) {
    return entry
      && namePattern.test(entry.name)
      && Number.isSafeInteger(entry.score)
      && entry.score >= 0
      && Number.isSafeInteger(entry.at);
  });
}

function readLocalRanking() {
  try {
    return validRankingEntries(JSON.parse(localStorage.getItem(rankingStorageKey) || "[]"));
  } catch (error) {
    return [];
  }
}

function writeLocalRanking(entries) {
  localStorage.setItem(rankingStorageKey, JSON.stringify(entries));
}

function publicRanking(entries) {
  return entries.slice().sort(byRank).map(function (entry, index) {
    return {
      rank: index + 1,
      name: entry.name,
      score: entry.score
    };
  });
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

function rankingSnapshot(entries, score) {
  const kept = entries.slice().sort(byRank).slice(0, maxRankingEntries);
  const body = { entries: publicRanking(kept) };
  if (score === undefined) {
    return body;
  }
  const rank = rankOf(entries, score, Date.now());
  if (rank <= maxRankingEntries) {
    body.rank = rank;
    body.eligible = true;
  } else {
    body.rank = null;
    body.eligible = false;
  }
  return body;
}

let publishedRankingPromise = null;

function loadPublishedRanking() {
  if (!publishedRankingPromise) {
    publishedRankingPromise = fetch("ranking.json", { cache: "no-cache" }).then(function (response) {
      if (!response.ok) {
        throw new Error("ranking");
      }
      return response.json();
    }).then(function (data) {
      return validRankingEntries(data);
    }).catch(function (error) {
      publishedRankingPromise = null;
      throw error;
    });
  }
  return publishedRankingPromise;
}

function staticRankingEntries() {
  return loadPublishedRanking().then(function (published) {
    return published.concat(readLocalRanking());
  }).catch(function () {
    const local = readLocalRanking();
    if (local.length === 0) {
      throw new Error("ranking");
    }
    return local;
  });
}

function loadRanking(score) {
  let url = "api/ranking";
  if (score !== undefined) {
    url += "?score=" + encodeURIComponent(score);
  }
  return fetch(url).then(function (response) {
    if (!response.ok) {
      throw new Error("ranking");
    }
    return response.json();
  }).catch(function () {
    return staticRankingEntries().then(function (entries) {
      return rankingSnapshot(entries, score);
    });
  });
}

function saveLocalRanking(name, score) {
  return loadPublishedRanking().catch(function () {
    return [];
  }).then(function (published) {
    const local = readLocalRanking();
    const entries = published.concat(local);
    const at = Date.now();
    const rank = rankOf(entries, score, at);
    if (rank > maxRankingEntries) {
      return { ok: true, data: { accepted: false, rank: null, eligible: false } };
    }
    const added = { name: name, score: score, at: at };
    const merged = published.concat(local, [added]).sort(byRank).slice(0, maxRankingEntries);
    const keptLocal = [];
    for (const entry of merged) {
      if (published.indexOf(entry) === -1) {
        keptLocal.push(entry);
      }
    }
    writeLocalRanking(keptLocal);
    return {
      ok: true,
      data: {
        accepted: true,
        rank: rank,
        entries: publicRanking(merged)
      }
    };
  });
}

function postRanking(name, score) {
  return fetch("api/ranking", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: name, score: score })
  }).then(function (response) {
    const type = response.headers.get("content-type") || "";
    if (type.indexOf("application/json") === -1) {
      throw new Error("ranking");
    }
    return response.json().then(function (data) {
      return { ok: response.ok, data: data };
    });
  }).catch(function () {
    return saveLocalRanking(name, score);
  });
}

function rankingRows(entries) {
  const rows = document.createElement("div");
  for (const entry of entries) {
    const row = document.createElement("p");
    row.className = "ranking-row";
    row.textContent = entry.rank + "位 " + entry.name + " " + entry.score;
    rows.appendChild(row);
  }
  return rows;
}

function showRanking(entries) {
  rankingTrack.classList.remove("is-scrolling");
  rankingTrack.textContent = "";
  rankingTrack.style.animationDuration = "";
  if (!entries || entries.length === 0) {
    const empty = document.createElement("p");
    empty.className = "ranking-row";
    empty.textContent = "まだありません";
    rankingTrack.appendChild(empty);
    return;
  }
  const rows = rankingRows(entries);
  rankingTrack.appendChild(rows);
  if (rows.offsetHeight <= rankingTrack.parentElement.clientHeight) {
    return;
  }
  const copy = rankingRows(entries);
  copy.setAttribute("aria-hidden", "true");
  rankingTrack.appendChild(copy);
  rankingTrack.style.animationDuration = (entries.length * 0.8) + "s";
  void rankingTrack.offsetWidth;
  rankingTrack.classList.add("is-scrolling");
}

function showRankingError() {
  rankingTrack.classList.remove("is-scrolling");
  rankingTrack.textContent = "";
  rankingTrack.style.animationDuration = "";
  const failed = document.createElement("p");
  failed.className = "ranking-row";
  failed.textContent = "読み込めませんでした";
  rankingTrack.appendChild(failed);
}

function refreshRanking() {
  return loadRanking().then(function (data) {
    showRanking(data.entries);
  }).catch(function () {
    showRankingError();
  });
}

function pickAnimal() {
  return animals[Math.floor(Math.random() * animals.length)];
}

function showNextAnimal() {
  nextName.textContent = nextAnimal.name;
  nextImage.src = nextAnimal.image;
  nextImage.alt = nextAnimal.name;
  nextDescription.textContent = nextAnimal.description;
}

function addBlock(x, y) {
  const block = document.createElement("div");
  block.className = "block";
  block.style.left = x + "px";
  block.style.bottom = y + "px";
  stage.appendChild(block);
  return block;
}

function bodySize() {
  return {
    width: box.bounds.max.x - box.bounds.min.x,
    height: box.bounds.max.y - box.bounds.min.y
  };
}

function moveBox(event) {
  const rect = stage.getBoundingClientRect();
  const size = bodySize();
  let x = event.clientX - rect.left;
  const minX = size.width / 2;
  const maxX = width - size.width / 2;

  if (x < minX) {
    x = minX;
  }
  if (x > maxX) {
    x = maxX;
  }
  Matter.Body.setPosition(box, { x: x, y: size.height / 2 });
}

function spawnPiece() {
  const shape = nextAnimal || pickAnimal();
  nextAnimal = pickAnimal();
  showNextAnimal();

  const partBodies = [];
  for (const part of shape.parts) {
    const vertices = [];
    for (const point of part) {
      vertices.push({ x: point.x, y: point.y });
    }
    const centre = Matter.Vertices.centre(vertices);
    partBodies.push(Matter.Body.create({
      position: { x: centre.x, y: centre.y },
      vertices: vertices
    }));
  }
  if (partBodies.length === 1) {
    box = partBodies[0];
  } else {
    box = Matter.Body.create({
      parts: partBodies
    });
  }
  Matter.Body.setPosition(box, { x: width / 2, y: shape.height / 2 });
  Matter.Body.setStatic(box, true);
  Matter.Composite.add(engine.world, box);

  const element = addBlock(0, 0);
  element.style.width = shape.width + "px";
  element.style.height = shape.height + "px";
  element.style.backgroundImage = "url(" + shape.image + ")";
  element.style.backgroundSize = "100% 100%";
  element.style.backgroundRepeat = "no-repeat";
  element.style.backgroundColor = "transparent";
  pieces.push({
    body: box,
    element: element,
    width: shape.width,
    height: shape.height,
    points: shape.points,
    image: shape.image
  });
  dropped = false;
}

function pieceIsOut(body) {
  return body.position.x < 0 || body.position.x > width || body.position.y > height;
}

function placedScore() {
  let score = 0;
  for (const piece of pieces) {
    if (piece.body === box || pieceIsOut(piece.body)) {
      continue;
    }
    score += piece.points;
  }
  return score;
}

function endGame(text, bonus) {
  if (lost) {
    return;
  }
  let score = placedScore();
  if (bonus) {
    score += bonus;
  }
  keepHighScore(score);
  lastScore = score;
  lost = true;
  releaseBody = null;
  dropped = true;
  box = null;
  prepareShareLink();
  shareButton.hidden = false;
  message.textContent = text + "　スコア: " + score;
  if (bonus) {
    message.textContent += "　ボーナス: " + bonus;
  }
  scoreBaseMessage = message.textContent;
  hideRegister();
  const thisRound = round;
  loadRanking(score).then(function (data) {
    if (thisRound !== round) {
      return;
    }
    message.textContent = messageWithRank(data.rank);
    if (data.eligible) {
      showRegister();
    }
  }).catch(function () {});
  Matter.Runner.stop(runner);
}

function resetGame() {
  round += 1;
  hideRegister();
  const runnerStopped = lost;
  for (const piece of pieces) {
    Matter.Composite.remove(engine.world, piece.body);
    piece.element.remove();
  }
  pieces.length = 0;
  dragging = false;
  dropped = false;
  box = null;
  releaseBody = null;
  fallingStarted = false;
  lost = false;
  nextAnimal = null;
  message.textContent = "";
  shareButton.hidden = true;
  if (runnerStopped) {
    Matter.Runner.run(runner, engine);
  }
  spawnPiece();
}

document.querySelector("#reset").addEventListener("click", function () {
  resetGame();
});

function submitScore() {
  if (registering || registerPanel.hidden) {
    return;
  }
  const thisRound = round;
  const name = playerNameInput.value.trim();
  if (!namePattern.test(name)) {
    registerNote.textContent = "名前は英数字4文字以内です";
    return;
  }
  registering = true;
  registerNote.textContent = "";
  postRanking(name, lastScore).then(function (result) {
    if (thisRound !== round) {
      return;
    }
    if (!result.ok) {
      registerNote.textContent = "登録できませんでした";
      return;
    }
    if (!result.data.accepted) {
      message.textContent = messageWithRank(null);
      hideRegister();
      return;
    }
    message.textContent = messageWithRank(result.data.rank);
    hideRegister();
    showRanking(result.data.entries);
  }).catch(function () {
    if (thisRound !== round) {
      return;
    }
    registerNote.textContent = "登録できませんでした";
  }).then(function () {
    if (thisRound === round) {
      registering = false;
    }
  });
}

document.querySelector("#register-no").addEventListener("click", function () {
  hideRegister();
});

document.querySelector("#register-yes").addEventListener("click", function () {
  submitScore();
});

playerNameInput.addEventListener("keydown", function (event) {
  if (event.key === "Enter") {
    submitScore();
  }
});

function shareText() {
  return "スコア: " + lastScore;
}

function postMessage() {
  return shareText() + "\n" + location.href;
}

function webIntentUrl() {
  return "https://twitter.com/intent/tweet?text=" + encodeURIComponent(postMessage());
}

function isPhone() {
  return /Android|iPhone|iPad|iPod/i.test(navigator.userAgent)
    || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

function prepareShareLink() {
  shareButton.href = webIntentUrl();
  shareButton.target = isPhone() ? "_self" : "_blank";
}

function openShare(event) {
  prepareShareLink();
  if (!isPhone() || !navigator.share) {
    return;
  }
  event.preventDefault();
  navigator.share({ text: postMessage() }).catch(function (error) {
    if (error && error.name === "AbortError") {
      return;
    }
    window.location.assign(webIntentUrl());
  });
}

shareButton.addEventListener("click", openShare);

document.querySelector("#rotate").addEventListener("click", function () {
  if (lost) {
    return;
  }
  if (!box || dropped) {
    return;
  }

  Matter.Body.setAngle(box, box.angle + quarterTurn);
  const size = bodySize();
  Matter.Body.setPosition(box, { x: box.position.x, y: size.height / 2 });
});

stage.addEventListener("pointerdown", function (event) {
  if (lost) {
    return;
  }
  if (dropped) {
    return;
  }
  dragging = true;
  moveBox(event);
});

window.addEventListener("pointermove", function (event) {
  if (lost) {
    return;
  }
  if (!dragging || dropped) {
    return;
  }
  moveBox(event);
});

window.addEventListener("pointerup", function () {
  if (lost) {
    return;
  }
  if (!dragging || dropped) {
    return;
  }
  dragging = false;
  dropped = true;
  fallingStarted = false;
  releaseBody = box;
  Matter.Body.setStatic(box, false);
  box = null;
});

const width = stage.clientWidth;
const height = stage.clientHeight;
const engine = Matter.Engine.create();
const ground = Matter.Bodies.rectangle(width / 2, height + groundThickness / 2, width, groundThickness, {
  isStatic: true
});
Matter.Composite.add(engine.world, ground);

Matter.Events.on(engine, "afterUpdate", function () {
  for (const piece of pieces) {
    piece.element.style.left = (piece.body.position.x - piece.width / 2) + "px";
    piece.element.style.bottom = (height - (piece.body.position.y + piece.height / 2)) + "px";
    piece.element.style.transform = "rotate(" + piece.body.angle + "rad)";
  }
  if (!lost) {
    for (const piece of pieces) {
      if (pieceIsOut(piece.body)) {
        endGame(loseMessage);
        break;
      }
    }
  }
  if (!lost && releaseBody) {
    if (releaseBody.speed > fallStartSpeed) {
      fallingStarted = true;
    }
    const stopped = fallingStarted && releaseBody.speed < stopSpeed;
    const clearedTop = releaseBody.bounds.min.y > nextAnimal.height;

    if (clearedTop) {
      releaseBody = null;
      fallingStarted = false;
      spawnPiece();
    } else if (stopped) {
      endGame(fullMessage, fullBonus);
    }
  }
});

const runner = Matter.Runner.create();
Matter.Runner.run(runner, engine);
showHighScore();
refreshRanking();
spawnPiece();
