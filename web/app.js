/* MySkate Coach's page. Live (opened from `npm run app` on a Mac): it asks the local server for a plan and shows each step as it
   happens. Demo (on GitHub Pages, where there is no server): it plays back recorded runs from demo/runs/, saying so. Either
   way the steps arrive as the same events ({ t, type, data }) and are drawn by show(). Everything from a run is put on the
   page as text (textContent), never as HTML. */
(function () {
  "use strict";
  var $ = function (id) { return document.getElementById(id); };
  var DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  var MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  var SLOTS = [30, 45, 60, 75, 90, 120];
  var still = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var state = { mode: null, slot: 60, day: "tomorrow", runs: [], run: null, busy: false, stepEls: {} };

  // a small element maker: el("p", { class: "x" }, "text", child, ...)
  function el(tag, attrs) {
    var node = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) { node.setAttribute(k, attrs[k]); });
    for (var i = 2; i < arguments.length; i++) {
      var c = arguments[i];
      if (c === null || c === undefined || c === false) continue;
      node.appendChild(typeof c === "string" || typeof c === "number" ? document.createTextNode(String(c)) : c);
    }
    return node;
  }
  function fmtDay(iso) {
    var p = String(iso).split("-").map(Number), d = new Date(p[0], p[1] - 1, p[2]);
    return DAYS[d.getDay()] + ", " + MONTHS[d.getMonth()] + " " + d.getDate();
  }
  var plural = function (n, one) { return n + " " + (n === 1 ? one : one + "s"); };

  /* ---------- the steps, drawn from events ---------- */
  function resetRun() {
    $("steps").textContent = "";
    state.stepEls = {};
    $("stepsCard").hidden = false;
    $("planCard").hidden = true;
    $("details").hidden = true;
    $("briefText").textContent = "";
    $("replyText").textContent = "";
  }
  // add or update a step: key, its kind (ok, bad, claude, wait), who did it, the words, and an optional list of lines
  function step(key, kind, who, text, lines) {
    var li = state.stepEls[key];
    if (!li) {
      li = el("li", { class: "step" });
      state.stepEls[key] = li;
      $("steps").appendChild(li);
    }
    li.className = "step " + kind;
    li.textContent = "";
    var mark = kind === "ok" ? "✓" : kind === "bad" ? "✗" : kind === "claude" ? "AI" : "";
    var body = el("div", {}, el("span", { class: "who" }, who), el("p", {}, text));
    if (lines && lines.length) body.appendChild(el.apply(null, ["ul", {}].concat(lines.map(function (l) { return el("li", { class: l[0] }, l[1]); }))));
    li.appendChild(el("span", { class: "dot", "aria-hidden": "true" }, kind === "wait" ? "" : mark));
    li.appendChild(body);
  }

  function show(ev) {
    var d = ev.data || {};
    switch (ev.type) {
      case "reading": step("read", "wait", "Code", "Reading " + d.file + "…"); break;
      case "read": step("read", "ok", "Code", "Read the backup: " + plural(d.sessions, "session") + (d.last ? ", the newest on " + fmtDay(d.last) : "") + "."); break;
      case "brief":
        step("brief", "ok", "Code", "Turned it into " + d.facts + " numbered facts and " + d.skills + " skills Claude may pick, for a " + d.slotMin + "-minute session on " + fmtDay(d.date) + ".");
        $("briefText").textContent = d.text || "";
        $("details").hidden = false;
        break;
      case "asking": step("ask" + d.n, "wait", "Claude", d.n === 1 ? "Claude is planning the session (" + d.model + ", no tools)…" : "Claude is fixing the plan…"); break;
      case "answered":
        if (d.ok) step("ask" + d.n, "claude", "Claude", (d.n === 1 ? "Claude answered" : "Claude answered again") + " in " + d.seconds + " seconds" + (d.model ? " (" + d.model + ")." : "."));
        else step("ask" + d.n, "bad", "Claude Code", d.message);
        if (d.ok) $("replyText").textContent = typeof d.reply === "string" ? d.reply : JSON.stringify(d.reply, null, 2);
        break;
      case "checked":
        if (d.ok) step("check" + d.n, "ok", "Code", d.n === 1 ? "Checked the plan: it passed every check." : "Checked it again: it passed.", d.passed.map(function (t) { return ["pass", t]; }));
        else step("check" + d.n, "bad", "Code", "Checked the plan: " + plural(d.problems.length, "problem") + ". " + (d.n === 1 ? "It goes back to Claude once, with this list." : "That was the second try."), d.problems.map(function (t) { return ["fail", t]; }));
        break;
      case "result": showPlan(d); break;
      case "saved": step("saved", "ok", "Code", "Saved the plan (" + d.planFile + ") and the run log (" + d.logFile + ") on this Mac."); break;
      case "error": step("error", "bad", "Code", d.message); break;
      default: break;
    }
  }

  function showPlan(d) {
    var plan = d.plan, mine = d.source === "myskate";
    $("planSource").textContent = mine ? "MySkate's own suggestion" : d.retried ? "Claude's plan, fixed on the second try and checked" : "Claude's plan, checked";
    $("planSource").className = "eyebrow" + (mine ? " own" : "");
    $("planTitle").textContent = fmtDay(plan.date) + " · " + plan.slotMin + " mins";
    $("planSummary").textContent = plan.summary;
    $("planReason").hidden = !mine;
    $("planReason").textContent = mine ? "Claude's plan could not be used: " + d.reason : "";
    var list = $("planItems");
    list.textContent = "";
    plan.items.forEach(function (it, i) {
      var bar = el("div", { class: "bar", "aria-hidden": "true" }, el("i", { style: "width:" + Math.round((it.minutes / plan.slotMin) * 100) + "%" }));
      list.appendChild(el("li", { class: "item" },
        el("div", { class: "item-head" }, el("span", {}, (i + 1) + ". " + it.name), el("span", { class: "mins" }, it.minutes + " min")),
        bar,
        el("p", {}, it.why),
        it.focus ? el("p", { class: "focus" }, "Focus: “" + it.focus + "”") : null));
    });
    $("planCard").hidden = false;
    // on a phone the plan is below the steps: bring it into view
    if (window.innerWidth < 960) $("planCard").scrollIntoView({ behavior: still ? "auto" : "smooth", block: "start" });
  }

  /* ---------- live: the local server ---------- */
  function startLive(status) {
    state.mode = "live";
    $("mode").textContent = "Live on this Mac · Claude Code, " + status.model;
    $("mode").className = "mode live";
    $("liveSetup").hidden = false;
    $("go").textContent = "Plan my session";
    var sel = $("backup");
    status.backups.forEach(function (b) { sel.appendChild(el("option", { value: b.id }, b.name)); });
    chipRow($("slots"), SLOTS.map(function (m) { return [String(m), m + " min"]; }), String(state.slot), function (v) { state.slot = Number(v); });
    chipRow($("days"), [["tomorrow", "Tomorrow"], ["today", "Today"]], state.day, function (v) { state.day = v; });
    if (!status.mySkate) return note("MySkate Coach needs MySkate in the folder next to it.");
    if (!status.signIn.ok) return note(status.signIn.message);
    $("go").disabled = false;
    $("go").onclick = runLive;
  }
  function chipRow(box, options, current, pick) {
    box.textContent = "";
    options.forEach(function (o) {
      var b = el("button", { type: "button", class: "chip", "aria-pressed": String(o[0] === current) }, o[1]);
      b.onclick = function () {
        [].forEach.call(box.children, function (c) { c.setAttribute("aria-pressed", "false"); });
        b.setAttribute("aria-pressed", "true");
        pick(o[0]);
      };
      box.appendChild(b);
    });
  }
  function note(text) { $("setupNote").textContent = text; }

  function runLive() {
    if (state.busy) return;
    state.busy = true;
    $("go").disabled = true;
    note("");
    resetRun();
    var q = "api/plan?backup=" + encodeURIComponent($("backup").value) + "&slot=" + state.slot + "&day=" + state.day;
    var src = new EventSource(q);
    var finish = function () { src.close(); state.busy = false; $("go").disabled = false; $("go").textContent = "Plan another"; };
    src.onmessage = function (m) {
      var ev = JSON.parse(m.data);
      if (ev.type === "done") return finish();
      show(ev);
    };
    src.onerror = function () { if (state.busy) { step("error", "bad", "Code", "Lost touch with the app. Is it still running (npm run app)?"); finish(); } };
  }

  /* ---------- demo: recorded runs ---------- */
  function startDemo() {
    state.mode = "demo";
    $("mode").textContent = "Demo · recorded runs, played back";
    $("mode").className = "mode demo";
    $("demoNotice").hidden = false;
    $("demoSetup").hidden = false;
    $("go").textContent = "Play this run";
    fetch("demo/runs/index.json").then(function (r) { return r.json(); }).then(function (runs) {
      state.runs = runs;
      runs.forEach(function (r, i) {
        var b = el("button", { type: "button", class: "run", "aria-pressed": String(i === 0) },
          el("b", {}, r.title, r.standIn ? el("span", { class: "tag" }, "stand-in") : null), el("span", {}, r.note));
        b.onclick = function () {
          [].forEach.call($("runs").children, function (c) { c.setAttribute("aria-pressed", "false"); });
          b.setAttribute("aria-pressed", "true");
          state.run = r;
        };
        $("runs").appendChild(b);
      });
      state.run = runs[0];
      $("go").disabled = false;
      $("go").onclick = playDemo;
    }).catch(function () { note("The recorded runs could not be loaded."); });
  }
  function playDemo() {
    if (state.busy || !state.run) return;
    state.busy = true;
    $("go").disabled = true;
    resetRun();
    fetch("demo/runs/" + state.run.file).then(function (r) { return r.json(); }).then(function (events) {
      var i = 0, last = 0;
      var next = function () {
        if (i >= events.length) { state.busy = false; $("go").disabled = false; $("go").textContent = "Play it again"; return; }
        var ev = events[i++];
        if (ev.type !== "done") show(ev);
        // the real timing, shortened: Claude's answer waits up to 2.5 seconds, everything else up to 0.6
        var gap = i < events.length ? events[i].t - ev.t : 0;
        var wait = still ? 0 : Math.min(gap, events[i] && events[i].type === "answered" ? 2500 : 600);
        last = setTimeout(next, wait);
      };
      next();
    }).catch(function () { state.busy = false; $("go").disabled = false; note("That recording could not be loaded."); });
  }

  /* ---------- which one ---------- */
  fetch("api/status").then(function (r) { if (!r.ok) throw new Error("no server"); return r.json(); }).then(startLive).catch(startDemo);
})();
