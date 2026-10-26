const stage = document.querySelector("#stage");
const message = document.querySelector("#message");
const nextName = document.querySelector("#next-name");
const nextImage = document.querySelector("#next-image");
const nextDescription = document.querySelector("#next-description");
const highScoreLabel = document.querySelector("#high-score");
const highScoreKey = "doubutsu-tower-high-score";

const fallStartSpeed = 0.4;
const stopSpeed = 0.15;
const spawnClearY = 72;
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
    points: shape.points
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
  lost = true;
  releaseBody = null;
  dropped = true;
  box = null;
  message.textContent = text + "　スコア: " + score;
  if (bonus) {
    message.textContent += "　ボーナス: " + bonus;
  }
  Matter.Runner.stop(runner);
}

function resetGame() {
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
  if (runnerStopped) {
    Matter.Runner.run(runner, engine);
  }
  spawnPiece();
}

document.querySelector("#reset").addEventListener("click", function () {
  resetGame();
});

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
    const clearedTop = releaseBody.bounds.min.y > spawnClearY;

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
spawnPiece();
