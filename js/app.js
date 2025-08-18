/* =========================
   IndexedDB wrapper + LocalStorage fallback
   ========================= */

const THEME_KEY = "tact_theme";

function getPreferredTheme() {
	const saved = localStorage.getItem(THEME_KEY);
	if (saved === "light" || saved === "dark") return saved;
	return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}
function applyTheme(theme) {
	document.documentElement.setAttribute("data-bs-theme", theme);
	const btn = document.getElementById("themeBtn");
	if (btn) {
		btn.setAttribute("aria-pressed", theme === "dark" ? "true" : "false");
		btn.title = theme === "dark" ? "Switch to light" : "Switch to dark";
		btn.innerHTML = theme === "dark" ? '<i class="bi bi-moon-stars"></i>' : '<i class="bi bi-sun"></i>';
	}
}
function setTheme(theme) {
	localStorage.setItem(THEME_KEY, theme);
	applyTheme(theme);
}
function installThemeToggle() {
	// initial
	applyTheme(getPreferredTheme());

	// click toggle
	const btn = document.getElementById("themeBtn");
	if (btn) {
		btn.addEventListener("click", () => {
			const next = document.documentElement.getAttribute("data-bs-theme") === "dark" ? "light" : "dark";
			setTheme(next);
		});
	}

	// follow OS changes until user picks explicitly
	if (!localStorage.getItem(THEME_KEY)) {
		const mq = window.matchMedia("(prefers-color-scheme: dark)");
		mq.addEventListener("change", (e) => applyTheme(e.matches ? "dark" : "light"));
	}
}

const idb = (() => {
	const hasIDB = !!window.indexedDB;
	const DB_NAME = "tactdb";
	const DB_VER = 1;
	let db;
	function open() {
		if (!hasIDB) return Promise.resolve(null);
		return new Promise((res, rej) => {
			const rq = indexedDB.open(DB_NAME, DB_VER);
			rq.onupgradeneeded = () => {
				const d = rq.result;
				if (!d.objectStoreNames.contains("tasks")) {
					const s = d.createObjectStore("tasks", { keyPath: "id" });
					s.createIndex("byDayStatus", ["dayKey", "status"], { unique: false });
					s.createIndex("byCompletedAt", "completedAt", { unique: false });
					s.createIndex("byProject", "projectId", { unique: false });
					s.createIndex("byTag", "tags", { unique: false, multiEntry: true });
					s.createIndex("byCreatedAt", "createdAt", { unique: false });
				}
				if (!d.objectStoreNames.contains("events")) {
					const s = d.createObjectStore("events", { keyPath: "id" });
					s.createIndex("byTask", "taskId", { unique: false });
					s.createIndex("byTs", "ts", { unique: false });
				}
				if (!d.objectStoreNames.contains("days")) {
					const s = d.createObjectStore("days", { keyPath: "id" });
					s.createIndex("byClosedAt", "closedAt", { unique: false });
				}
			};
			rq.onsuccess = () => {
				db = rq.result;
				res(db);
			};
			rq.onerror = () => rej(rq.error);
		});
	}
	function tx(store, mode = "readonly") {
		return db.transaction(store, mode).objectStore(store);
	}
	const ls = {
		_get(k) {
			return JSON.parse(localStorage.getItem(k) || "[]");
		},
		_set(k, v) {
			localStorage.setItem(k, JSON.stringify(v));
		},
		async put(store, obj) {
			const k = "__" + store;
			const a = ls._get(k);
			const i = a.findIndex((x) => x.id === obj.id);
			if (i >= 0) a[i] = obj;
			else a.push(obj);
			ls._set(k, a);
			return obj;
		},
		async get(store, id) {
			return ls._get("__" + store).find((x) => x.id === id) || null;
		},
		async delete(store, id) {
			const k = "__" + store;
			ls._set(
				k,
				ls._get(k).filter((x) => x.id !== id)
			);
		},
		async all(store) {
			return ls._get("__" + store);
		},
		async indexQuery(store, pred) {
			return ls._get("__" + store).filter(pred);
		},
		async clear(store) {
			ls._set("__" + store, []);
		},
	};
	async function ensure() {
		if (hasIDB && !db) await open();
	}
	return {
		async ready() {
			await ensure();
		},
		async put(store, obj) {
			if (!hasIDB) return ls.put(store, obj);
			return new Promise((res, rej) => {
				const rq = tx(store, "readwrite").put(obj);
				rq.onsuccess = () => res(obj);
				rq.onerror = () => rej(rq.error);
			});
		},
		async get(store, id) {
			if (!hasIDB) return ls.get(store, id);
			return new Promise((res, rej) => {
				const rq = tx(store).get(id);
				rq.onsuccess = () => res(rq.result || null);
				rq.onerror = () => rej(rq.error);
			});
		},
		async delete(store, id) {
			if (!hasIDB) return ls.delete(store, id);
			return new Promise((res, rej) => {
				const rq = tx(store, "readwrite").delete(id);
				rq.onsuccess = () => res();
				rq.onerror = () => rej(rq.error);
			});
		},
		async all(store) {
			if (!hasIDB) return ls.all(store);
			return new Promise((res, rej) => {
				const rq = tx(store).getAll();
				rq.onsuccess = () => res(rq.result || []);
				rq.onerror = () => rej(rq.error);
			});
		},
		async index(store, indexName, query) {
			if (!hasIDB) {
				if (indexName === "byDayStatus") {
					const [d, s] = query;
					return ls.indexQuery(store, (t) => t.dayKey === d && t.status === s);
				}
				if (indexName === "byProject") {
					return ls.indexQuery(store, (t) => t.projectId === query);
				}
				if (indexName === "byTag") {
					return ls.indexQuery(store, (t) => Array.isArray(t.tags) && t.tags.includes(query));
				}
				if (indexName === "byCompletedAt") {
					return ls.indexQuery(store, (t) => t.completedAt != null);
				}
				if (indexName === "byCreatedAt") {
					return ls.indexQuery(store, (_) => true);
				}
				return ls.all(store);
			}
			return new Promise((res, rej) => {
				const s = tx(store).index(indexName);
				const rq = Array.isArray(query) ? s.getAll(IDBKeyRange.only(query)) : s.getAll(query);
				rq.onsuccess = () => res(rq.result || []);
				rq.onerror = () => rej(rq.error);
			});
		},
		async clear(store) {
			if (!hasIDB) return ls.clear(store);
			return new Promise((res, rej) => {
				const rq = tx(store, "readwrite").clear();
				rq.onsuccess = () => res();
				rq.onerror = () => rej(rq.error);
			});
		},
		hasIDB,
	};
})();

/* ========= Utilities ========= */
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : "id-" + Math.random().toString(36).slice(2));
const pad2 = (n) => String(n).padStart(2, "0");
const fmtDate = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const todayKey = () => fmtDate(new Date());
const tomorrowKey = () => fmtDate(new Date(Date.now() + 86400000));
const minutes = (n) => `${n | 0}m`;
const fromMinutes = (m) => ({ h: Math.floor(m / 60), m: m % 60 });
const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
const nowTs = () => Date.now();

/* ========= BroadcastChannel ========= */
const bc = "BroadcastChannel" in window ? new BroadcastChannel("tact") : null;
function bcPost(msg) {
	const on = document.getElementById("bcSync").checked;
	if (bc && on) bc.postMessage(msg);
}
if (bc) {
	bc.onmessage = (e) => {
		if (e.data?.type === "refresh") renderAll();
	};
}

/* ========= Crypto (optional notes encryption) ========= */
const cryptoState = { key: null, salt: null };
async function deriveKey(pass, salt) {
	const enc = new TextEncoder();
	const baseKey = await crypto.subtle.importKey("raw", enc.encode(pass), "PBKDF2", false, ["deriveKey"]);
	return crypto.subtle.deriveKey({ name: "PBKDF2", salt, iterations: 100_000, hash: "SHA-256" }, baseKey, { name: "AES-GCM", length: 256 }, false, [
		"encrypt",
		"decrypt",
	]);
}
async function setPassphrase(pass) {
	if (!pass) {
		cryptoState.key = null;
		cryptoState.salt = null;
		return;
	}
	const salt = crypto.getRandomValues(new Uint8Array(16));
	cryptoState.key = await deriveKey(pass, salt);
	cryptoState.salt = salt;
}
async function encText(s) {
	if (!cryptoState.key) return { ct: s, iv: null, salt: null, enc: false };
	const iv = crypto.getRandomValues(new Uint8Array(12));
	const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, cryptoState.key, new TextEncoder().encode(s || ""));
	return {
		ct: btoa(String.fromCharCode(...new Uint8Array(ct))),
		iv: btoa(String.fromCharCode(...iv)),
		salt: btoa(String.fromCharCode(...cryptoState.salt)),
		enc: true,
	};
}
async function decText(obj) {
	if (!obj || !obj.enc) return obj?.ct ?? "";
	if (!cryptoState.key) return "[set passphrase to view]";
	const iv = Uint8Array.from(atob(obj.iv), (c) => c.charCodeAt(0));
	const salt = Uint8Array.from(atob(obj.salt), (c) => c.charCodeAt(0));
	if (cryptoState.salt && (cryptoState.salt.length !== salt.length || cryptoState.salt.some((v, i) => v !== salt[i]))) return "[passphrase mismatch]";
	try {
		const pt = await crypto.subtle.decrypt(
			{ name: "AES-GCM", iv },
			cryptoState.key,
			Uint8Array.from(atob(obj.ct), (c) => c.charCodeAt(0))
		);
		return new TextDecoder().decode(pt);
	} catch {
		return "[decrypt failed]";
	}
}

/* ========= Persistence API ========= */
const DB = {
	async addTask(t) {
		await idb.put("tasks", t);
		bcPost({ type: "refresh" });
	},
	async updateTask(t) {
		await idb.put("tasks", t);
		bcPost({ type: "refresh" });
	},
	async removeTask(id) {
		await idb.delete("tasks", id);
		bcPost({ type: "refresh" });
	},
	async tasks() {
		return idb.all("tasks");
	},
	async byDayStatus(day, status) {
		return idb.index("tasks", "byDayStatus", [day, status]);
	},
	async events() {
		const arr = await idb.all("events");
		return arr.sort((a, b) => a.ts - b.ts);
	},
	async addEvent(ev) {
		await idb.put("events", ev);
	},
	async addDay(d) {
		await idb.put("days", d);
	},
	async clearAll() {
		await idb.clear("tasks");
		await idb.clear("events");
		await idb.clear("days");
		bcPost({ type: "refresh" });
	},
};
async function log(type, taskId, meta = {}) {
	await DB.addEvent({ id: uid(), taskId, type, ts: nowTs(), meta });
	renderEvents();
}

/* ========= Parser ========= */
function parseQuick(s, defaultDay = true) {
	const orig = s.trim();
	if (!orig) return null;
	if (orig.includes("\n"))
		return orig
			.split(/\r?\n/)
			.map((x) => x.trim())
			.filter(Boolean)
			.map((line) => parseQuick(line, defaultDay))
			.filter(Boolean);
	let title = orig;
	if (title.startsWith("/standup"))
		return [
			parseQuick("Write standup: yesterday @ops ~5m today 9am"),
			parseQuick("Write standup: today @ops ~10m today 9:10am"),
			parseQuick("Write standup: blockers @ops ~5m today 9:20am"),
		];
	if (title.startsWith("/code-review")) return parseQuick("Code review @deep #eng ~30m today");

	const tags = [...title.matchAll(/(^|\\s)@([a-z0-9\\-_]+)/gi)].map((m) => m[2].toLowerCase());
	const proj = title.match(/(^|\\s)#([a-z0-9\\-_]+)/i)?.[2] || null;
	title = title
		.replace(/(^|\\s)[@#][a-z0-9\\-_]+/gi, " ")
		.replace(/\\s+/g, " ")
		.trim();

	let estimateMin = 0;
	const est = title.match(/~\\s*(\\d+)\\s*([mh])?/i);
	if (est) {
		const n = parseInt(est[1], 10);
		const unit = (est[2] || "m").toLowerCase();
		estimateMin = unit === "h" ? n * 60 : n;
		title = title.replace(est[0], "").trim();
	}

	let dayKey = defaultDay ? todayKey() : null;
	if (/\\btomorrow\\b/i.test(title)) {
		dayKey = tomorrowKey();
		title = title.replace(/\\btomorrow\\b/gi, "").trim();
	}
	if (/\\btoday\\b/i.test(title)) {
		dayKey = todayKey();
		title = title.replace(/\\btoday\\b/gi, "").trim();
	}

	let startAt = null;
	const m = title.match(/\\b(\\d{1,2})(?::(\\d{2}))?\\s*(am|pm)?\\b/i);
	if (m) {
		let hh = parseInt(m[1], 10);
		const mm = m[2] ? parseInt(m[2], 10) : 0;
		const ap = (m[3] || "").toLowerCase();
		if (ap === "pm" && hh < 12) hh += 12;
		if (ap === "am" && hh === 12) hh = 0;
		const base = new Date();
		if (dayKey) {
			const [Y, M, D] = dayKey.split("-").map(Number);
			base.setFullYear(Y, M - 1, D);
		}
		base.setHours(hh, mm, 0, 0);
		startAt = base.getTime();
		title = title.replace(m[0], "").trim();
	}

	return {
		id: uid(),
		title: title || "(untitled)",
		notes: null,
		status: dayKey === todayKey() ? "today" : "backlog",
		projectId: proj,
		tags,
		estimateMin,
		actualMin: 0,
		createdAt: nowTs(),
		startAt,
		completedAt: null,
		dayKey,
		rolloverCount: 0,
		blockedReason: null,
		order: nowTs(),
	};
}

/* ========= State ========= */
const el = (s) => document.querySelector(s);
const state = { filter: { q: "" }, wipLimit: 2, availableHours: 6, focusTaskId: null, timer: null, timerEnd: 0 };
const modals = { focus: null, settings: null, cmd: null };

/* ========= Render ========= */
function setTodayLabel() {
	const d = new Date();
	const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
	el("#todayLabel").innerHTML = `<span class="fw-bolder">Today:</span> ${days[d.getDay()]} • ${fmtDate(d)}`;
}

function warnBar(text) {
	el("#warnwrap").innerHTML = text ? `<div class="alert alert-warning border mb-0">${text}</div>` : "";
}

async function renderAll() {
	const day = todayKey();
	const [todayList, inprog, doneList] = await Promise.all([DB.byDayStatus(day, "today"), DB.byDayStatus(day, "in-progress"), DB.byDayStatus(day, "done")]);
	const q = state.filter.q.trim().toLowerCase();
	const match = (t) => !q || [t.title, t.notes?.ct || "", (t.tags || []).join(" "), t.projectId || ""].join(" ").toLowerCase().includes(q);

	const todo = [...todayList.filter(match), ...inprog.filter(match)].sort((a, b) => a.order - b.order);
	const done = doneList.filter(match).sort((a, b) => a.completedAt - b.completedAt);

	el("#todayCount").textContent = todo.length;
	el("#doneCount").textContent = done.length;
	el("#wipPill").textContent = `${inprog.length}/${state.wipLimit}`;
	const estSum = todo.reduce((s, t) => s + (t.estimateMin || 0), 0);
	el("#estPill").textContent = minutes(estSum);
	if (estSum > state.availableHours * 60) {
		const h = fromMinutes(estSum);
		warnBar(`Time-budget alert: estimates total ${h.h}h ${h.m}m vs available ${state.availableHours}h.`);
	} else warnBar("");

	renderList(el("#listToday"), todo, "today");
	renderList(el("#listDone"), done, "done");
	renderEvents();
}

function renderList(container, items, which) {
	container.innerHTML = "";
	items.forEach((t) => {
		const li = document.createElement("div");
		li.className = "list-group-item bg-body-tertiary border-0";
		const row = document.createElement("div");
		row.className = "task";
		row.draggable = which !== "done";
		row.dataset.id = t.id;

		const handle = document.createElement("i");
		handle.className = "bi bi-grip-vertical hdl";
		const mid = document.createElement("div");
		const right = document.createElement("div");
		right.className = "btn-group btn-group-sm";
		const ttl = document.createElement("div");
		ttl.className = "fw-semibold";
		ttl.textContent = t.title;
		mid.appendChild(ttl);

		const badges = document.createElement("div");
		badges.className = "d-flex gap-1 flex-wrap my-1";
		if (t.projectId) {
			badges.appendChild(makeBadge("#" + t.projectId, "secondary"));
		}
		(t.tags || []).forEach((tag) => badges.appendChild(makeBadge("@" + tag, "secondary")));
		if (t.estimateMin) {
			badges.appendChild(makeBadge("~" + minutes(t.estimateMin), "secondary"));
		}
		if (t.rolloverCount) {
			badges.appendChild(makeBadge("↩︎" + t.rolloverCount, "secondary"));
		}
		if (t.status === "in-progress") {
			badges.appendChild(makeBadge("▶ in-progress", "primary"));
		}
		if (t.blockedReason) {
			badges.appendChild(makeBadge("⛔ blocked", "danger"));
		}
		mid.appendChild(badges);

		if (t.notes) {
			const n = document.createElement("div");
			n.className = "text-secondary small";
			n.textContent = "[notes stored]";
			mid.appendChild(n);
		}

		if (which !== "done") {
			right.appendChild(
				iconBtn("bi-play-fill", "Start", async () => {
					const inprog = await DB.byDayStatus(todayKey(), "in-progress");
					if (t.status !== "in-progress" && inprog.length >= state.wipLimit) {
						flash("WIP limit reached", true);
						return;
					}
					t.status = "in-progress";
					if (!t.startAt) t.startAt = nowTs();
					await DB.updateTask(t);
					await log("start", t.id);
					renderAll();
				})
			);
			right.appendChild(
				iconBtn("bi-check2", "Complete", async () => {
					t.status = "done";
					t.completedAt = nowTs();
					await DB.updateTask(t);
					await log("complete", t.id);
					renderAll();
				})
			);
			right.appendChild(iconBtn("bi-arrows-fullscreen", "Focus", () => openFocus(t.id)));
			right.appendChild(
				iconBtn("bi-arrow-return-left", "Defer", async () => {
					const reason = prompt("Reason on defer? (optional)");
					t.status = "today";
					t.startAt = null;
					t.blockedReason = reason || t.blockedReason;
					t.order = nowTs();
					await DB.updateTask(t);
					await log("edit", t.id, { action: "defer", reason });
					renderAll();
				})
			);
			right.appendChild(
				iconBtn("bi-trash", "Delete", async () => {
					if (!confirm("Delete task?")) return;
					await DB.removeTask(t.id);
					await log("edit", t.id, { action: "delete" });
					renderAll();
				})
			);
		} else {
			right.appendChild(
				iconBtn("bi-arrow-counterclockwise", "Undo", async () => {
					t.status = "today";
					t.completedAt = null;
					await DB.updateTask(t);
					await log("edit", t.id, { action: "undoComplete" });
					renderAll();
				})
			);
		}

		row.appendChild(handle);
		row.appendChild(mid);
		row.appendChild(right);
		li.appendChild(row);
		container.appendChild(li);

		if (row.draggable) {
			row.addEventListener("dragstart", (ev) => {
				row.classList.add("dragging");
				ev.dataTransfer.setData("text/plain", t.id);
			});
			row.addEventListener("dragend", () => row.classList.remove("dragging"));
		}
	});

	// drop logic
	container.addEventListener("dragover", (ev) => {
		ev.preventDefault();
		const after = getDragAfterElement(container, ev.clientY);
		showDropHint(container, after);
	});
	container.addEventListener("dragleave", () => clearDropHint(container));
	container.addEventListener("drop", async (ev) => {
		ev.preventDefault();
		const id = ev.dataTransfer.getData("text/plain");
		const t = await idb.get("tasks", id);
		const toDone = container.dataset.list === "done";
		if (toDone) {
			t.status = "done";
			t.completedAt = nowTs();
		} else {
			t.status = t.status === "done" ? "today" : t.status;
			t.dayKey = todayKey();
		}
		const after = getDragAfterElement(container, ev.clientY);
		const pivot = after ? after.dataset.id : null;
		let order = nowTs();
		if (pivot) {
			const p = await idb.get("tasks", pivot);
			order = p.order - 1;
		}
		t.order = order;
		await DB.updateTask(t);
		await log("edit", t.id, { action: "drag", to: container.dataset.list });
		clearDropHint(container);
		renderAll();
	});
}
function makeBadge(text, theme) {
	const s = document.createElement("span");
	s.className = `badge rounded-pill text-bg-${theme}`;
	s.textContent = text;
	return s;
}
function iconBtn(icon, title, on) {
	const b = document.createElement("button");
	b.className = "btn btn-outline-secondary";
	b.title = title;
	b.innerHTML = `<i class="${icon}"></i>`;
	b.onclick = on;
	return b;
}
function showDropHint(container, after) {
	clearDropHint(container);
	const hint = document.createElement("div");
	hint.className = "drop-hint";
	if (!after) container.appendChild(hint);
	else container.insertBefore(hint, after.closest(".list-group-item"));
}
function clearDropHint(container) {
	container.querySelectorAll(".drop-hint").forEach((x) => x.remove());
}
function getDragAfterElement(container, y) {
	const els = [...container.querySelectorAll(".list-group-item .task:not(.dragging)")];
	return els.reduce(
		(closest, child) => {
			const box = child.getBoundingClientRect();
			const offset = y - box.top - box.height / 2;
			if (offset < 0 && offset > closest.offset) return { offset, element: child };
			else return closest;
		},
		{ offset: -Infinity, element: null }
	).element;
}

async function renderEvents() {
	const wrap = el("#events");
	const events = await DB.events();
	wrap.innerHTML = events
		.slice(-300)
		.map((ev) => {
			const d = new Date(ev.ts);
			return `<div>${fmtDate(d)} ${pad2(d.getHours())}:${pad2(d.getMinutes())} • ${ev.type} ${
				ev.taskId ? '<span class="text-secondary">(' + ev.taskId.slice(0, 8) + ")</span>" : ""
			}</div>`;
		})
		.join("");
}

/* ========= Quick add ========= */
async function addFromQuick() {
	const s = el("#quick").value;
	const parsed = parseQuick(s);
	if (!parsed) return;
	const tasks = Array.isArray(parsed) ? parsed : [parsed];
	for (const t of tasks) {
		const all = await DB.tasks();
		const dup = all.find(
			(x) => x.title.trim().toLowerCase() === t.title.trim().toLowerCase() && ["today", "backlog", "in-progress"].includes(x.status) && !x.completedAt
		);
		if (dup) {
			const ok = confirm(`Duplicate detected: “${t.title}”. Add anyway?`);
			if (!ok) continue;
		}
		await DB.addTask(t);
		await log("create", t.id, { source: "quick" });
	}
	el("#quick").value = "";
	renderAll();
}

/* ========= Close Day ========= */
async function closeDay() {
	const day = todayKey();
	const [todo, inprog, done] = await Promise.all([DB.byDayStatus(day, "today"), DB.byDayStatus(day, "in-progress"), DB.byDayStatus(day, "done")]);
	for (const t of done) {
		if (!t.completedAt) {
			t.completedAt = nowTs();
			await DB.updateTask(t);
			await log("complete", t.id, { auto: true });
		}
	}
	const unfinished = [...todo, ...inprog];
	const threshold = 3;
	for (const t of unfinished) {
		t.rolloverCount = (t.rolloverCount || 0) + 1;
		t.dayClosedAt = nowTs();
		t.dayKey = tomorrowKey();
		t.status = "today";
		await DB.updateTask(t);
		await log("rollover", t.id, { to: t.dayKey, count: t.rolloverCount });
		if (t.rolloverCount >= threshold) {
			setTimeout(() => alert(`Rollover x${t.rolloverCount}: Consider delete, delegate, or rescope — “${t.title}”`), 0);
		}
	}
	const finalDone = await DB.byDayStatus(day, "done");
	const withTimes = el("#withTimes").checked;
	const fmt = document.querySelector('input[name="fmt"]:checked').value;
	const snap = await buildSummary(day, finalDone, unfinished, withTimes, fmt === "md");
	await DB.addDay({ id: day, closedAt: nowTs(), counts: { done: finalDone.length, unfinished: unfinished.length }, snapshotMarkdown: snap });
	await log("closeDay", null, { day });
	try {
		await navigator.clipboard.writeText(snap);
		flash("Summary copied");
	} catch {
		flash("Copy failed", true);
	}
	renderAll();
}

// put this near your other utils
function isoWeek(d) {
	const x = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
	const day = x.getUTCDay() || 7;
	x.setUTCDate(x.getUTCDate() + 4 - day);
	const yearStart = new Date(Date.UTC(x.getUTCFullYear(), 0, 1));
	return Math.ceil(((x - yearStart) / 86400000 + 1) / 7);
}

// replace existing buildSummary with this
async function buildSummary(day, done, unfinished, withTimes = true, markdown = true) {
	const [Y, M, D] = day.split("-").map(Number);
	const d = new Date(Y, M - 1, D);
	const weekSuffix = d.getDay() === 1 ? ` — Week ${isoWeek(d)}` : "";

	const lines = [];
	const head = markdown ? `# ${day} — Daily Summary${weekSuffix}` : `${day} — Daily Summary${weekSuffix}`;
	lines.push(head, "");

	lines.push(markdown ? `## Done (${done.length})` : `Done (${done.length})`);
	for (const t of done) {
		const when = withTimes && t.completedAt ? `  — ${new Date(t.completedAt).toLocaleTimeString()}` : "";
		const dur = t.actualMin ? ` [${t.actualMin}m]` : t.estimateMin ? ` [~${t.estimateMin}m]` : "";
		const line = `${markdown ? "- " : ""}${t.title}${dur}${when}${t.projectId ? `  #${t.projectId}` : ""} ${(t.tags || []).map((x) => "@" + x).join(" ")}`;
		lines.push(line.trim());
	}
	lines.push("");

	lines.push(markdown ? `## Rolled over to ${tomorrowKey()} (${unfinished.length})` : `Rolled over to ${tomorrowKey()} (${unfinished.length})`);
	for (const t of unfinished) {
		const info = [];
		if (t.rolloverCount) info.push(`↩︎${t.rolloverCount}`);
		if (t.estimateMin) info.push(`~${t.estimateMin}m`);
		lines.push(`${markdown ? "- " : ""}${t.title} ${info.join(" ")}`.trim());
	}
	lines.push("");

	return lines.join("\n"); // real newlines
}

/* ========= Focus + timer ========= */
function openFocus(id) {
	state.focusTaskId = id;
	idb.get("tasks", id).then(async (t) => {
		el("#focusTitle").textContent = t.title;
		el("#focusNotes").value = await decText(t.notes || null);
		el("#clock").textContent = "00:00";
		el("#timerMsg").textContent = "Press Start to begin";
		modals.focus.show();
	});
}
function startTimer() {
	const mins = parseInt(el("#timerLen").value, 10);
	state.timerEnd = Date.now() + mins * 60000;
	el("#toggleTimer").textContent = "Stop";
	el("#timerMsg").textContent = "Running…";
	state.timer = setInterval(tick, 200);
}
function stopTimer() {
	if (state.timer) {
		clearInterval(state.timer);
		state.timer = null;
	}
	el("#toggleTimer").textContent = "Start";
}
async function tick() {
	const left = Math.max(0, state.timerEnd - Date.now());
	const mm = Math.floor(left / 60000),
		ss = Math.floor((left % 60000) / 1000);
	el("#clock").textContent = `${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")}`;
	if (left <= 0) {
		stopTimer();
		el("#timerMsg").textContent = "Logged.";
		if (state.focusTaskId) {
			const t = await idb.get("tasks", state.focusTaskId);
			const mins = parseInt(el("#timerLen").value, 10);
			t.actualMin = (t.actualMin || 0) + mins;
			await DB.updateTask(t);
			await log("edit", t.id, { action: "logTime", minutes: mins });
			renderAll();
		}
	}
}

/* ========= Export / Import ========= */
async function exportJson() {
	const payload = { exportedAt: nowTs(), tasks: await DB.tasks(), events: await DB.events() };
	const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
	const url = URL.createObjectURL(blob);
	const a = document.createElement("a");
	a.href = url;
	a.download = `tact-${todayKey()}.json`;
	a.click();
	URL.revokeObjectURL(url);
}
async function importJson(file) {
	const text = await file.text();
	const data = JSON.parse(text);
	if (!Array.isArray(data.tasks) || !Array.isArray(data.events)) {
		alert("Invalid file");
		return;
	}
	await DB.clearAll();
	for (const t of data.tasks) {
		await DB.addTask(t);
	}
	for (const e of data.events) {
		await DB.addEvent(e);
	}
	renderAll();
	flash("Imported");
}

/* ========= Helpers ========= */
function flash(msg, bad = false) {
	const cont = el("#toastWrap");
	const t = document.createElement("div");
	t.className = `toast align-items-center text-bg-${bad ? "danger" : "success"} border-0`;
	t.role = "status";
	t.ariaLive = "polite";
	t.ariaAtomic = "true";
	t.innerHTML = `<div class="d-flex"><div class="toast-body">${msg}</div><button type="button" class="btn-close btn-close-white me-2 m-auto" data-bs-dismiss="toast"></button></div>`;
	cont.appendChild(t);
	const inst = new bootstrap.Toast(t, { delay: 1600 });
	t.addEventListener("hidden.bs.toast", () => t.remove());
	inst.show();
}
function toClipboard(s) {
	return navigator.clipboard.writeText(s);
}

/* ========= Keyboard + palette ========= */
document.addEventListener("keydown", async (e) => {
	const tag = e.target && /INPUT|TEXTAREA/.test(e.target.tagName);
	if (!tag && e.key.toLowerCase() === "q") {
		e.preventDefault();
		el("#quick").focus();
	}
	if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
		e.preventDefault();
		openCmd();
	}
	if (!tag && ["Enter", "c", "C", "f", "F", "d", "D"].includes(e.key)) {
		const first = el("#listToday .task");
		if (!first) return;
		const id = first.dataset.id;
		const t = await idb.get("tasks", id);
		if (e.key === "Enter") {
			const inprog = await DB.byDayStatus(todayKey(), "in-progress");
			if (t.status !== "in-progress" && inprog.length >= state.wipLimit) {
				flash("WIP limit reached", true);
				return;
			}
			t.status = "in-progress";
			if (!t.startAt) t.startAt = nowTs();
			await DB.updateTask(t);
			await log("start", t.id);
			renderAll();
		}
		if (e.key.toLowerCase() === "c") {
			t.status = "done";
			t.completedAt = nowTs();
			await DB.updateTask(t);
			await log("complete", t.id);
			renderAll();
		}
		if (e.key.toLowerCase() === "f") {
			openFocus(t.id);
		}
		if (e.key.toLowerCase() === "d") {
			t.status = "today";
			t.startAt = null;
			t.order = nowTs();
			await DB.updateTask(t);
			await log("edit", t.id, { action: "defer" });
			renderAll();
		}
	}
});

const commands = [
	{ key: "close", desc: "Close Day", run: () => closeDay() },
	{ key: "export", desc: "Export JSON", run: () => exportJson() },
	{ key: "import", desc: "Open import in Settings", run: () => modals.settings.show() },
	{
		key: "wip ",
		desc: 'Set WIP limit (e.g. "wip 2")',
		run: (v) => {
			const n = parseInt(v.split(/\\s+/)[1] || "2", 10);
			el("#wipLimit").value = n;
			state.wipLimit = n;
			renderAll();
		},
	},
	{
		key: "filter @",
		desc: "Filter tag. Example: filter @deep",
		run: (v) => {
			const tag = v.split("@")[1]?.trim();
			el("#search").value = "@" + tag;
			onSearch();
		},
	},
	{
		key: "filter #",
		desc: "Filter project. Example: filter #clientA",
		run: (v) => {
			const pj = v.split("#")[1]?.trim();
			el("#search").value = "#" + pj;
			onSearch();
		},
	},
	{
		key: "timer ",
		desc: "Set focus timer (25|35|45|50)",
		run: (v) => {
			const n = parseInt(v.split(/\\s+/)[1] || "25", 10);
			el("#timerLen").value = String(n);
		},
	},
];
function openCmd() {
	el("#cmdInput").value = "";
	renderCmd("");
	modals.cmd.show();
	setTimeout(() => el("#cmdInput").focus(), 50);
}
function renderCmd(q) {
	const list = el("#cmdItems");
	const items = commands.filter((c) => c.key.startsWith(q) || q.startsWith(c.key)).slice(0, 8);
	list.innerHTML = items
		.map(
			(c, i) =>
				`<button type="button" class="list-group-item list-group-item-action d-flex justify-content-between ${i === 0 ? "active" : ""}" data-idx="${i}"><span>${
					c.key
				}</span><small class="text-secondary">${c.desc}</small></button>`
		)
		.join("");
	list.querySelectorAll(".list-group-item").forEach(
		(btn) =>
			(btn.onclick = () => {
				const idx = parseInt(btn.dataset.idx, 10);
				(items[idx] || items[0]).run(q);
				modals.cmd.hide();
			})
	);
}
el("#cmdInput").addEventListener("input", (e) => renderCmd(e.target.value.trim()));
el("#cmdInput").addEventListener("keydown", (e) => {
	if (e.key === "Enter") {
		const q = el("#cmdInput").value.trim();
		const cmd = commands.find((c) => q.startsWith(c.key)) || commands[0];
		if (cmd) {
			cmd.run(q);
			modals.cmd.hide();
		}
	}
	if (e.key === "Escape") {
		modals.cmd.hide();
	}
});

function onSearch() {
	state.filter.q = el("#search").value;
	renderAll();
}

// PWA install flow
let deferredPrompt = null;
const installBtn = document.getElementById("installBtn");

window.addEventListener("beforeinstallprompt", (e) => {
	e.preventDefault();
	deferredPrompt = e;
	installBtn.hidden = false;
	console.log("bip fired");
});

installBtn?.addEventListener("click", async () => {
	if (!deferredPrompt) return;
	installBtn.disabled = true;
	deferredPrompt.prompt();
	await deferredPrompt.userChoice;
	deferredPrompt = null;
	installBtn.hidden = true;
	installBtn.disabled = false;
});

window.addEventListener("appinstalled", () => {
	deferredPrompt = null;
	installBtn?.setAttribute("hidden", "");
	console.log("installed");
});

// quick sanity checks
window.addEventListener("load", async () => {
	console.log(
		"manifest",
		await fetch("./manifest.webmanifest")
			.then((r) => r.status)
			.catch(() => 0)
	);
	console.log("sw ctrl", !!navigator.serviceWorker.controller);
	console.log("standalone", matchMedia("(display-mode: standalone)").matches);
});

/* ========= Wire up ========= */
el("#addBtn").onclick = addFromQuick;
el("#quick").addEventListener("keydown", (e) => {
	if (e.key === "Enter") addFromQuick();
});
el("#search").addEventListener("input", onSearch);
el("#closeDay").onclick = closeDay;
el("#copyList").onclick = async () => {
	const day = todayKey();
	const done = await DB.byDayStatus(day, "done");
	const todo = (await DB.byDayStatus(day, "today")).concat(await DB.byDayStatus(day, "in-progress"));
	const withTimes = el("#withTimes").checked;
	const fmt = document.querySelector('input[name="fmt"]:checked').value;
	const snap = await buildSummary(day, done, todo, withTimes, fmt === "md");
	try {
		await toClipboard(snap);
		flash("Copied");
	} catch {
		flash("Copy failed", true);
	}
};
el("#clearDone").onclick = async () => {
	if (!confirm("Clear today’s done tasks?")) return;
	const done = await DB.byDayStatus(todayKey(), "done");
	for (const t of done) {
		await DB.removeTask(t.id);
		await log("edit", t.id, { action: "clearDone" });
	}
	renderAll();
};
el("#exportBtn").onclick = exportJson;
el("#importBtn").onclick = () => modals.settings.show();
el("#settingsBtn").onclick = () => modals.settings.show();
el("#applyCrypto").onclick = async () => {
	const pass = el("#cryptoPass").value;
	if (!pass) {
		await setPassphrase(null);
		el("#cryptoStatus").textContent = "encryption off";
		el("#cryptoStatus").className = "";
		return;
	}
	await setPassphrase(pass);
	el("#cryptoStatus").textContent = "enabled for notes in this tab";
	el("#cryptoStatus").className = "text-success";
};
el("#resetApp").onclick = async () => {
	if (!confirm("Erase all tasks, events, and days?")) return;
	await DB.clearAll();
	renderAll();
};
el("#filePicker").addEventListener("change", (ev) => {
	const f = ev.target.files[0];
	if (f) importJson(f);
});
document.getElementById("toggleTimer").onclick = () => {
	if (state.timer) stopTimer();
	else startTimer();
};

// --- Bootstrap alert ---
function showUpdateBanner(onReload) {
	const id = "update-banner";
	if (document.getElementById(id)) return;
	const div = document.createElement("div");
	div.id = id;
	div.className = "alert alert-info alert-dismissible fade show shadow position-fixed start-50 translate-middle-x";
	div.style.cssText = "top:1rem;z-index:1080;max-width:720px;width:calc(100% - 2rem);";
	div.innerHTML = `
    <div class="d-flex align-items-center justify-content-between">
      <div><strong>Update available.</strong> Reload to get the latest version.</div>
      <div class="d-flex gap-2">
        <button class="btn btn-sm btn-primary" id="btnReloadNow">Reload</button>
        <button type="button" class="btn-close" data-bs-dismiss="alert" aria-label="Close"></button>
      </div>
    </div>`;
	document.body.appendChild(div);
	document.getElementById("btnReloadNow").onclick = onReload;
}

// --- Service worker registration ---
if ("serviceWorker" in navigator) {
	window.addEventListener("load", async () => {
		const reg = await navigator.serviceWorker.register("./sw.js", { scope: "./" });
		reg?.update();

		// show if an update is already waiting
		if (reg.waiting) showUpdateBanner(() => reg.waiting.postMessage({ type: "SKIP_WAITING" }));

		// show when a new worker finishes installing
		reg.addEventListener("updatefound", () => {
			const nw = reg.installing;
			nw?.addEventListener("statechange", () => {
				if (nw.state === "installed" && navigator.serviceWorker.controller) {
					showUpdateBanner(() => reg.waiting?.postMessage({ type: "SKIP_WAITING" }));
				}
			});
		});

		// reload after SKIP_WAITING activates
		navigator.serviceWorker.addEventListener("controllerchange", () => location.reload());
	});
}

/* ========= Init ========= */
(async function init() {
	setTodayLabel();
	await idb.ready();
	modals.focus = new bootstrap.Modal("#focusModal");
	modals.settings = new bootstrap.Modal("#settingsModal");
	modals.cmd = new bootstrap.Modal("#cmdModal");

	state.wipLimit = parseInt(localStorage.getItem("__wip") || "2", 10);
	el("#wipLimit").value = state.wipLimit;
	el("#wipLimit").addEventListener("change", (e) => {
		state.wipLimit = clamp(parseInt(e.target.value, 10), 1, 5);
		localStorage.setItem("__wip", state.wipLimit);
		renderAll();
	});

	state.availableHours = parseFloat(localStorage.getItem("__avail") || "6");
	el("#availHours").value = state.availableHours;
	el("#availHours").addEventListener("change", (e) => {
		state.availableHours = parseFloat(e.target.value);
		localStorage.setItem("__avail", state.availableHours);
		renderAll();
	});
	installThemeToggle(); // call this before renderAll()

	renderAll();
})();
