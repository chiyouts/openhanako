function escHtml(value) {
  return String(value == null ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function encodeFile(value) {
  return encodeURIComponent(String(value || ""));
}

export default function registerCardRoute(app, ctx) {
  app.get("/card", (c) => {
    const batchId = c.req.query("batch");
    if (!batchId) return c.text("Missing batch parameter", 400);

    const store = ctx._mediaGen?.store;
    const tasks = store?.getByBatch(batchId) || [];
    const token = c.req.query("token") || "";
    const pluginId = ctx.pluginId;
    const mediaBase = `/api/plugins/${pluginId}`;
    const tokenParam = token ? `?token=${token}` : "";
    const hanaCss = c.req.query("hana-css") || "";
    const hasPending = tasks.some((task) => task.status === "pending");
    const ratio = tasks[0]?.params?.ratio || "1:1";
    const [rw, rh] = ratio.split(":").map(Number);
    const cssRatio = (rw && rh) ? `${rw}/${rh}` : "1/1";
    const pollApi = `${mediaBase}/tasks/batch/${encodeURIComponent(batchId)}${tokenParam}`;

    function renderCellInner(task) {
      if (task.status === "done" && task.files?.length) {
        const file = task.files[0];
        const encoded = encodeFile(file);
        const mediaUrl = `${mediaBase}/media/${encoded}${tokenParam}`;
        const isVideo = /\.(mp4|mov)$/i.test(file);
        if (isVideo) {
          return `<button class="media-btn video-wrap" type="button" data-kind="video" data-file="${escHtml(file)}" data-url="${escHtml(mediaUrl)}" onclick="openMediaFromNode(this)"><video src="${mediaUrl}" preload="metadata" muted playsinline></video><div class="play-btn">▶</div></button>`;
        }
        return `<button class="media-btn image-wrap" type="button" data-kind="image" data-file="${escHtml(file)}" data-url="${escHtml(mediaUrl)}" onclick="openMediaFromNode(this)"><img src="${mediaUrl}" alt="${escHtml(file)}"></button>`;
      }
      if (task.status === "failed") {
        return `<div class="failed">${escHtml(task.failReason || "generation failed")}</div>`;
      }
      return `<div class="skeleton"></div>`;
    }

    let cellsHtml = tasks
      .map((task) => `<div class="cell" data-task-id="${escHtml(task.taskId)}" data-state="${escHtml(task.status || "pending")}">${renderCellInner(task)}</div>`)
      .join("");
    if (!cellsHtml) cellsHtml = `<div class="failed">task not found</div>`;

    const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  ${hanaCss ? `<link rel="stylesheet" href="${hanaCss}">` : ""}
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { background: var(--bg-card, #FCFAF5); padding: 6px; }
    .cell { display: block; }
    .media-btn { display: block; width: 100%; padding: 0; border: 0; background: transparent; cursor: zoom-in; }
    img { display: block; max-width: 100%; border-radius: 8px; }
    .skeleton { aspect-ratio: ${cssRatio}; max-height: 580px; background: linear-gradient(90deg, #f0ede8 25%, #e8e4de 50%, #f0ede8 75%); background-size: 200% 100%; animation: shimmer 1.5s infinite; border-radius: 4px; }
    @keyframes shimmer { 0% { background-position: 200% 0; } 100% { background-position: -200% 0; } }
    .video-wrap { position: relative; border-radius: 8px; overflow: hidden; }
    .video-wrap video { display: block; max-width: 100%; border-radius: 8px; }
    .play-btn { position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); width: 48px; height: 48px; background: rgba(0, 0, 0, 0.5); border-radius: 50%; display: flex; align-items: center; justify-content: center; color: #fff; font-size: 20px; pointer-events: none; }
    .failed { padding: 12px; color: #c0392b; font-size: 12px; }
  </style>
</head>
<body>
  ${cellsHtml}
  <script>
    (function () {
      var pollApi = ${JSON.stringify(pollApi)};
      var mediaBase = ${JSON.stringify(mediaBase)};
      var tokenParam = ${JSON.stringify(tokenParam)};
      var hasPending = ${hasPending ? "true" : "false"};
      var POLL_MS = 2000;
      var ERROR_BACKOFF_MS = 3000;
      var timer = null;

      function esc(s) {
        return String(s == null ? "" : s)
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;")
          .replace(/"/g, "&quot;")
          .replace(/'/g, "&#39;");
      }

      window.openMediaFromNode = function(node) {
        var file = node.getAttribute("data-file") || "";
        var url = node.getAttribute("data-url") || "";
        var kind = node.getAttribute("data-kind") || "image";
        parent.postMessage({
          type: "open-media-viewer",
          payload: {
            kind: kind,
            name: file,
            url: url,
            ext: (String(file).split(".").pop() || "").toLowerCase()
          }
        }, "*");
      };

      function buildInner(task) {
        if (task.status === "done" && task.files && task.files.length) {
          var file = task.files[0];
          var encoded = encodeURIComponent(String(file));
          var mediaUrl = mediaBase + "/media/" + encoded + tokenParam;
          if (/\\.(mp4|mov)$/i.test(file)) {
            return '<button class="media-btn video-wrap" type="button" data-kind="video" data-file="' + esc(file) + '" data-url="' + esc(mediaUrl) + '" onclick="openMediaFromNode(this)"><video src="' + mediaUrl + '" preload="metadata" muted playsinline></video><div class="play-btn">▶</div></button>';
          }
          return '<button class="media-btn image-wrap" type="button" data-kind="image" data-file="' + esc(file) + '" data-url="' + esc(mediaUrl) + '" onclick="openMediaFromNode(this)"><img src="' + mediaUrl + '" alt="' + esc(file) + '"></button>';
        }
        if (task.status === "failed") {
          return '<div class="failed">' + esc(task.failReason || "generation failed") + '</div>';
        }
        return '<div class="skeleton"></div>';
      }

      function findCell(taskId) {
        var safe = String(taskId).replace(/[^a-zA-Z0-9_-]/g, "");
        if (safe !== String(taskId)) return null;
        return document.querySelector('[data-task-id="' + safe + '"]');
      }

      async function poll() {
        timer = null;
        try {
          var res = await fetch(pollApi, { cache: "no-store" });
          if (!res.ok) throw new Error("http " + res.status);
          var data = await res.json();
          var pending = false;
          for (var i = 0; i < (data.tasks || []).length; i += 1) {
            var task = data.tasks[i];
            if (task.status === "pending") pending = true;
            var cell = findCell(task.taskId);
            if (!cell) continue;
            if (cell.dataset.state === task.status) continue;
            cell.innerHTML = buildInner(task);
            cell.dataset.state = task.status;
          }
          if (pending) timer = setTimeout(poll, POLL_MS);
        } catch (err) {
          timer = setTimeout(poll, ERROR_BACKOFF_MS);
        }
      }

      function notifyResize() {
        parent.postMessage({
          type: "resize-request",
          payload: { width: document.body.scrollWidth, height: document.body.scrollHeight }
        }, "*");
      }

      var imgs = document.querySelectorAll("img");
      var remaining = imgs.length;
      function initialReady() {
        notifyResize();
        parent.postMessage({ type: "ready" }, "*");
      }
      if (!remaining) {
        requestAnimationFrame(initialReady);
      } else {
        [].forEach.call(imgs, function(img) {
          if (img.complete) {
            remaining -= 1;
            if (remaining === 0) initialReady();
            return;
          }
          img.onload = img.onerror = function() {
            remaining -= 1;
            if (remaining === 0) initialReady();
          };
        });
      }

      new ResizeObserver(notifyResize).observe(document.body);
      if (hasPending) timer = setTimeout(poll, POLL_MS);
    })();
  </script>
</body>
</html>`;

    return c.html(html);
  });
}
