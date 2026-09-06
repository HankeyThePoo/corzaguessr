(function polyfill() {
	const relList = document.createElement("link").relList;
	if (relList && relList.supports && relList.supports("modulepreload")) return;
	for (const link of document.querySelectorAll("link[rel=\"modulepreload\"]")) processPreload(link);
	new MutationObserver((mutations) => {
		for (const mutation of mutations) {
			if (mutation.type !== "childList") continue;
			for (const node of mutation.addedNodes) if (node.tagName === "LINK" && node.rel === "modulepreload") processPreload(node);
		}
	}).observe(document, {
		childList: true,
		subtree: true
	});
	function getFetchOpts(link) {
		const fetchOpts = {};
		if (link.integrity) fetchOpts.integrity = link.integrity;
		if (link.referrerPolicy) fetchOpts.referrerPolicy = link.referrerPolicy;
		if (link.crossOrigin === "use-credentials") fetchOpts.credentials = "include";
		else if (link.crossOrigin === "anonymous") fetchOpts.credentials = "omit";
		else fetchOpts.credentials = "same-origin";
		return fetchOpts;
	}
	function processPreload(link) {
		if (link.ep) return;
		link.ep = true;
		const fetchOpts = getFetchOpts(link);
		fetch(link.href, fetchOpts);
	}
})();
var snippetDurations = [
	1,
	2,
	4,
	8,
	16,
	32
];
var puzzleAttemptCount = snippetDurations.length;
var maxPuzzleSnippetSeconds = snippetDurations.at(-1);
var modeRules = {
	classic: {
		initialTimeMs: null,
		description: "GUESS THE TRACK IN SIX TRIES AS MORE AUDIO IS REVEALED",
		gameplay: "puzzle",
		clockDisplay: "snippet",
		failurePolicy: "heard-fixed",
		prefetchRounds: false
	},
	daily: {
		initialTimeMs: null,
		description: "ONE SHARED TRACK EACH DAY, GUESS IT IN SIX TRIES",
		gameplay: "puzzle",
		clockDisplay: "snippet",
		failurePolicy: "fixed",
		prefetchRounds: false
	},
	blitz: {
		initialTimeMs: 6e4,
		description: "GUESS AS MANY TRACKS AS POSSIBLE BEFORE THE TIMER RUNS OUT",
		gameplay: "timed",
		clockDisplay: "countdown",
		failurePolicy: "replace",
		prefetchRounds: true
	},
	seek: {
		initialTimeMs: null,
		description: "PLACE THE EIGHT-SECOND SNIPPET ON THE SONG TIMELINE",
		gameplay: "position",
		clockDisplay: "position",
		failurePolicy: "replace",
		prefetchRounds: true,
		snippetSeconds: 8,
		roundCount: 5,
		maxPointsPerRound: 1e3
	},
	gauntlet: {
		initialTimeMs: 3e4,
		description: "SURVIVE UNTIL YOU DISCOVER EVERY SONG",
		gameplay: "timed",
		clockDisplay: "elapsed",
		failurePolicy: "replace",
		prefetchRounds: true,
		timeAdjustmentsMs: {
			correct: 3e3,
			wrong: -1e3,
			skip: -2e3
		}
	}
};
var regularModes = [
	"daily",
	"classic",
	"blitz",
	"seek"
];
var seekMaxScore = modeRules.seek.roundCount * modeRules.seek.maxPointsPerRound;
function isTimedMode(mode) {
	return mode !== null && modeRules[mode].gameplay === "timed";
}
function isPuzzleMode(mode) {
	return mode !== null && modeRules[mode].gameplay === "puzzle";
}
function isPositionMode(mode) {
	return mode !== null && modeRules[mode].gameplay === "position";
}
function clockDisplayForMode(mode) {
	return modeRules[mode].clockDisplay;
}
function snippetSeconds(attempt) {
	return snippetDurations[Math.max(0, Math.min(puzzleAttemptCount - 1, attempt))];
}
function skipLabel(mode, attempt) {
	if (mode === null) return "ADD 1S";
	if (isTimedMode(mode)) return "SKIP";
	if (isPuzzleMode(mode)) {
		if (attempt >= puzzleAttemptCount - 1) return "GIVE UP";
		return `ADD ${snippetDurations[attempt + 1] - snippetDurations[attempt]}S`;
	}
	throw new Error(`Unsupported skip-label mode: ${String(mode)}`);
}
function seekPoints(guessedSecond, actualSecond, duration) {
	if (!Number.isFinite(duration) || duration <= 0) return 0;
	const relativeError = Math.min(1, Math.abs(guessedSecond - actualSecond) / duration);
	return Math.round(modeRules.seek.maxPointsPerRound * (1 - relativeError) ** 3);
}
function seekAttemptPoints(attempt) {
	return seekPoints(attempt.guessedSecond, attempt.actualSecond, attempt.trackDuration);
}
function seekScore(attempts) {
	return attempts.reduce((total, attempt) => total + seekAttemptPoints(attempt), 0);
}
function accuracy(correct, guesses) {
	return guesses > 0 ? Math.round(correct * 100 / guesses) : 0;
}
function updateClassicBest(bests, won, attempt) {
	const classic = bests.classic;
	if (won) {
		classic.current += 1;
		classic.snippetTotal += snippetSeconds(attempt);
		const average = classic.snippetTotal / classic.current;
		const isBest = classic.current > classic.best || classic.current === classic.best && (!classic.bestSnippetTotal || classic.snippetTotal < classic.bestSnippetTotal);
		if (isBest) {
			classic.best = classic.current;
			classic.bestSnippetTotal = classic.snippetTotal;
		}
		return {
			changed: true,
			newPersonalBest: isBest,
			streak: classic.current,
			average
		};
	}
	const streak = classic.current;
	const average = classic.current ? classic.snippetTotal / classic.current : 0;
	const changed = classic.current !== 0 || classic.snippetTotal !== 0;
	classic.current = 0;
	classic.snippetTotal = 0;
	return {
		changed,
		newPersonalBest: false,
		streak,
		average
	};
}
function updateBlitzBest(bests, score, runAccuracy) {
	const current = bests.blitz;
	const higherScore = score > current.score;
	const strongerTie = score > 0 && score === current.score && runAccuracy > (current.accuracy ?? -1);
	if (!higherScore && !strongerTie) return false;
	bests.blitz = {
		score,
		accuracy: runAccuracy
	};
	return true;
}
function updateGauntletBest(bests, won, elapsedMs, trackCount) {
	if (!won || trackCount <= 0) return false;
	const current = bests.gauntlet;
	const largerCatalog = trackCount > current.trackCount;
	const fasterCurrentCatalog = trackCount === current.trackCount && (current.trackCount === 0 || elapsedMs < current.timeMs);
	if (!largerCatalog && !fasterCurrentCatalog) return false;
	bests.gauntlet = {
		timeMs: elapsedMs,
		trackCount
	};
	return true;
}
function updateSeekBest(bests, score) {
	if (score <= bests.seek.score) return false;
	bests.seek = { score };
	return true;
}
function seekResultScore(result) {
	return result.rounds.reduce((total, round) => total + round.points, 0);
}
function gauntletCompleted(result) {
	return result.catalogTrackCount > 0 && result.completedTracks >= result.catalogTrackCount;
}
function puzzleCompleted(attempts) {
	return attempts[0]?.outcome === "correct" || attempts.length === puzzleAttemptCount;
}
function summarizeDiscovery(tracks, discoveries) {
	const discovered = tracks.reduce((total, track) => total + Number(discoveries.has(track.dailyNumber)), 0);
	const total = tracks.length;
	return {
		discovered,
		total,
		percentage: total ? Math.round(discovered * 100 / total) : 0,
		complete: total > 0 && discovered === total
	};
}
function isIsoDate(value) {
	if (typeof value !== "string") return false;
	const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
	if (!match) return false;
	const year = Number(match[1]);
	const month = Number(match[2]);
	const day = Number(match[3]);
	if (month < 1 || month > 12 || day < 1) return false;
	return day <= [
		31,
		year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0) ? 29 : 28,
		31,
		30,
		31,
		30,
		31,
		31,
		30,
		31,
		30,
		31
	][month - 1];
}
function validateTrackCatalog(value) {
	if (!Array.isArray(value)) throw new Error("Track catalog is not an array.");
	if (value.length === 0) throw new Error("Track catalog is empty.");
	const titles = /* @__PURE__ */ new Set();
	const numbers = /* @__PURE__ */ new Set();
	const tracks = value.map((candidate, index) => {
		const fail = (reason) => {
			throw new Error(`Track catalog entry ${index + 1} ${reason}`);
		};
		if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) fail("is not an object.");
		const record = candidate;
		const title = typeof record.title === "string" ? record.title.trim() : "";
		const duration = record.duration;
		const spotify = typeof record.spotify === "string" ? record.spotify.trim() : "";
		const dailyNumber = record.dailyNumber;
		const releaseDate = record.releaseDate === null ? null : typeof record.releaseDate === "string" ? record.releaseDate.trim() : fail("has an invalid releaseDate.");
		if (!title) fail("has no title.");
		if (titles.has(title)) fail(`duplicates title "${title}".`);
		if (typeof duration !== "number" || !Number.isFinite(duration) || duration <= 0) fail("has an invalid duration.");
		if (!Number.isSafeInteger(dailyNumber) || Number(dailyNumber) <= 0) fail("has an invalid dailyNumber.");
		if (numbers.has(Number(dailyNumber))) fail(`duplicates dailyNumber ${String(dailyNumber)}.`);
		if (spotify && !/^[A-Za-z0-9]{22}$/.test(spotify)) fail("has an invalid Spotify track ID.");
		if (releaseDate !== null && !isIsoDate(releaseDate)) fail("has an invalid releaseDate.");
		titles.add(title);
		numbers.add(Number(dailyNumber));
		return {
			title,
			duration: Number(duration),
			spotify,
			dailyNumber: Number(dailyNumber),
			releaseDate,
			isNew: record.isNew === true
		};
	});
	if (tracks.length < modeRules.seek.roundCount) throw new Error(`Track catalog requires at least ${modeRules.seek.roundCount} tracks for Seek.`);
	return tracks;
}
function stableHash(value) {
	let hash = 2166136261;
	for (let index = 0; index < value.length; index += 1) {
		hash ^= value.charCodeAt(index);
		hash = Math.imul(hash, 16777619);
	}
	return hash >>> 0;
}
function selectDailyTrack(tracks, date, persistedNumber) {
	const available = tracks.filter((track) => isReleasedBy(track, date));
	if (available.length === 0) return null;
	if (persistedNumber !== null) {
		const persisted = available.find((track) => track.dailyNumber === persistedNumber);
		if (persisted) return persisted;
	}
	let selected = available[0];
	let selectedHash = stableHash(`corzaguessr-daily:${date}:${selected.dailyNumber}`);
	for (const track of available.slice(1)) {
		const hash = stableHash(`corzaguessr-daily:${date}:${track.dailyNumber}`);
		if (hash > selectedHash) {
			selected = track;
			selectedHash = hash;
		}
	}
	return selected;
}
function isDailyTrackAvailable(tracks, date, dailyNumber) {
	return tracks.some((track) => track.dailyNumber === dailyNumber && isReleasedBy(track, date));
}
function maximumClipStart(track, clipSeconds) {
	const clip = Math.min(clipSeconds, track.duration);
	return Math.max(0, Math.floor(track.duration - clip));
}
function dailyClipStart(track, date) {
	const maximum = maximumClipStart(track, maxPuzzleSnippetSeconds);
	return stableHash(`corzaguessr-daily-clip:${date}:${track.dailyNumber}`) % (maximum + 1);
}
function randomClipStart(track, clipSeconds, random = Math.random) {
	const maximum = maximumClipStart(track, clipSeconds);
	return Math.floor(clampRandom(random()) * (maximum + 1));
}
function selectRandomTrack(tracks, failed, previousTrackId, random = Math.random) {
	const playable = tracks.filter((track) => !failed.has(track.dailyNumber));
	if (playable.length === 0) return null;
	const withoutPrevious = playable.length > 1 && previousTrackId !== null ? playable.filter((track) => track.dailyNumber !== previousTrackId) : playable;
	const candidates = withoutPrevious.length ? withoutPrevious : playable;
	return candidates[Math.min(candidates.length - 1, Math.floor(clampRandom(random()) * candidates.length))] ?? null;
}
function clampRandom(value) {
	return Math.max(0, Math.min(.999999999999, value));
}
function isReleasedBy(track, date) {
	return track.releaseDate !== null && track.releaseDate <= date;
}
var copy = {
	modePrompt: "SELECT A MODE TO BEGIN",
	loadingCatalog: "LOADING TRACKLIST...",
	catalogError: "COULD NOT LOAD THE TRACKLIST.",
	loadingTrack: "LOADING TRACK...",
	trackError: "COULD NOT PLAY TRACK, PRESS PLAY TO CONTINUE!",
	selectedTrackRetry: "THE SELECTED TRACK COULD NOT BE PLAYED. PRESS PLAY TO RETRY.",
	selectedTrackReplacing: "THE SELECTED TRACK COULD NOT BE PLAYED. TRYING ANOTHER.",
	trackUnavailable: "TRACK IS UNAVAILABLE.",
	progress: "VIEW YOUR RECORDS AND THE TRACKS YOU'VE DISCOVERED"
};
function seekFeedback(attempt) {
	const distance = Math.abs(attempt.guessedSecond - attempt.actualSecond);
	return [`${distance} SECOND${distance === 1 ? "" : "S"} AWAY`, `${seekAttemptPoints(attempt)} POINTS`];
}
var months = [
	"January",
	"February",
	"March",
	"April",
	"May",
	"June",
	"July",
	"August",
	"September",
	"October",
	"November",
	"December"
];
function formatOrdinalDate(value) {
	const parts = dateParts(value);
	if (!parts) return value;
	const { year, monthName, day: numericDay } = parts;
	const remainder = numericDay % 100;
	const suffix = remainder >= 11 && remainder <= 13 ? "TH" : numericDay % 10 === 1 ? "ST" : numericDay % 10 === 2 ? "ND" : numericDay % 10 === 3 ? "RD" : "TH";
	return `${monthName.toUpperCase()} ${numericDay}${suffix}, ${year}`;
}
function formatShareDate(value) {
	const parts = dateParts(value);
	return parts ? `${parts.monthName} ${parts.day}, ${parts.year}` : value;
}
function dateParts(value) {
	const [, year, month, day] = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value) ?? [];
	const monthName = month ? months[Number(month) - 1] : void 0;
	return year && monthName && day ? {
		year,
		monthName,
		day: Number(day)
	} : null;
}
var shareUrl = "https://stolenvalorhq.com/corzaguessr";
function formatDailyShare(date, result) {
	const attempts = Math.max(1, Math.min(puzzleAttemptCount, Math.trunc(result.attempts)));
	const squares = Array.from({ length: puzzleAttemptCount }, (_, index) => result.won && index === attempts - 1 ? "🟪" : "⬛").join(" ");
	const outcome = result.won ? `I got it in ${attempts} ${attempts === 1 ? "try" : "tries"}!` : `I didn't get it in ${puzzleAttemptCount} tries!`;
	return `CORZAGUESSR✦ DAILY // ${formatShareDate(date)}\n\n${squares}\n${outcome}\n\n${shareUrl}`;
}
var browserAnimationScheduler = {
	requestFrame: (callback) => window.requestAnimationFrame(callback),
	cancelFrame: (handle) => window.cancelAnimationFrame(handle),
	setTimer: (callback, delayMs) => window.setTimeout(callback, delayMs),
	clearTimer: (handle) => window.clearTimeout(handle)
};
var GameClock = class {
	callbacks;
	now;
	scheduler;
	anchorMs = null;
	elapsedMs = 0;
	remainingMs = 1e3;
	maxRemainingMs = 1e3;
	frame = 0;
	timer = 0;
	generation = 0;
	constructor(callbacks, now = () => performance.now(), scheduler = browserAnimationScheduler) {
		this.callbacks = callbacks;
		this.now = now;
		this.scheduler = scheduler;
	}
	configure(milliseconds) {
		this.cancelScheduled();
		this.anchorMs = null;
		this.elapsedMs = 0;
		this.remainingMs = milliseconds;
		this.maxRemainingMs = milliseconds;
		this.generation += 1;
	}
	start() {
		if (this.anchorMs !== null || this.remainingMs <= 0) return;
		this.anchorMs = this.now();
		this.schedule();
	}
	pause() {
		this.commit();
		this.anchorMs = null;
		this.generation += 1;
		this.cancelScheduled();
		const snapshot = this.snapshot();
		this.callbacks.onTick(snapshot);
		return snapshot;
	}
	restart(milliseconds) {
		this.configure(milliseconds);
		this.callbacks.onTick(this.snapshot());
	}
	extendTo(milliseconds) {
		const wasRunning = this.anchorMs !== null;
		this.commit();
		this.remainingMs = Math.max(0, milliseconds - this.elapsedMs);
		this.maxRemainingMs = Math.max(this.maxRemainingMs, milliseconds);
		this.anchorMs = wasRunning && this.remainingMs > 0 ? this.now() : null;
		this.generation += 1;
		this.cancelScheduled();
		if (this.anchorMs !== null) this.schedule();
		this.callbacks.onTick(this.snapshot());
	}
	adjust(milliseconds) {
		this.commit();
		this.remainingMs = Math.max(0, this.remainingMs + milliseconds);
		this.maxRemainingMs = Math.max(this.maxRemainingMs, this.remainingMs);
		if (this.anchorMs !== null && this.remainingMs > 0) this.anchorMs = this.now();
		if (this.remainingMs <= 0) {
			this.anchorMs = null;
			this.cancelScheduled();
		} else if (this.anchorMs !== null) {
			this.generation += 1;
			this.cancelScheduled();
			this.schedule();
		}
		const snapshot = this.snapshot();
		this.callbacks.onTick(snapshot);
		return snapshot;
	}
	snapshot() {
		const projected = this.project(this.now());
		return {
			running: this.anchorMs !== null,
			elapsedMs: projected.elapsedMs,
			remainingMs: projected.remainingMs,
			maxRemainingMs: this.maxRemainingMs
		};
	}
	project(at) {
		if (this.anchorMs === null) return {
			elapsedMs: this.elapsedMs,
			remainingMs: this.remainingMs
		};
		const delta = Math.max(0, at - this.anchorMs);
		return {
			elapsedMs: this.elapsedMs + delta,
			remainingMs: Math.max(0, this.remainingMs - delta)
		};
	}
	commit() {
		if (this.anchorMs === null) return;
		const now = this.now();
		const projected = this.project(now);
		this.elapsedMs = projected.elapsedMs;
		this.remainingMs = projected.remainingMs;
		this.anchorMs = now;
	}
	schedule() {
		const generation = this.generation;
		const tick = () => {
			if (this.anchorMs === null || generation !== this.generation) return;
			const snapshot = this.snapshot();
			this.callbacks.onTick(snapshot);
			if (snapshot.remainingMs > 0) this.frame = this.scheduler.requestFrame(tick);
		};
		this.frame = this.scheduler.requestFrame(tick);
		this.timer = this.scheduler.setTimer(() => {
			if (this.anchorMs === null || generation !== this.generation) return;
			this.commit();
			this.anchorMs = null;
			this.remainingMs = 0;
			this.cancelScheduled();
			const snapshot = this.snapshot();
			this.callbacks.onTick(snapshot);
			this.callbacks.onExpired(snapshot);
		}, Math.max(0, this.remainingMs));
	}
	cancelScheduled() {
		if (this.frame) this.scheduler.cancelFrame(this.frame);
		if (this.timer) this.scheduler.clearTimer(this.timer);
		this.frame = 0;
		this.timer = 0;
	}
};
var dailyDateFormatter = new Intl.DateTimeFormat("en", {
	timeZone: "Europe/Budapest",
	year: "numeric",
	month: "2-digit",
	day: "2-digit"
});
function dailyDate(date = /* @__PURE__ */ new Date()) {
	const parts = Object.fromEntries(dailyDateFormatter.formatToParts(date).map(({ type, value }) => [type, value]));
	return `${parts.year}-${parts.month}-${parts.day}`;
}
var browserRuntime = {
	now: () => Date.now(),
	setTimeout: (callback, delayMs) => window.setTimeout(callback, delayMs),
	clearTimeout: (handle) => window.clearTimeout(handle)
};
var DailySchedule = class {
	onDateChanged;
	runtime;
	boundaryTimer = 0;
	countdownTimer = 0;
	nextBoundaryAt = 0;
	countdownTick = null;
	currentDate = "";
	remainingMs = 0;
	get date() {
		return this.currentDate;
	}
	get countdownMs() {
		return this.remainingMs;
	}
	constructor(onDateChanged, runtime = browserRuntime) {
		this.onDateChanged = onDateChanged;
		this.runtime = runtime;
	}
	current() {
		const date = dailyDate(new Date(this.runtime.now()));
		if (!this.currentDate) this.currentDate = date;
		return date;
	}
	start() {
		this.currentDate = dailyDate(new Date(this.runtime.now()));
		this.scheduleNextBoundary();
		return this.currentDate;
	}
	startCountdown(onTick) {
		this.countdownTick = onTick;
		if (!this.nextBoundaryAt) return;
		this.emitCountdown();
	}
	stopCountdown() {
		this.remainingMs = 0;
		this.countdownTick = null;
		if (this.countdownTimer) this.runtime.clearTimeout(this.countdownTimer);
		this.countdownTimer = 0;
	}
	reconcile() {
		const date = dailyDate(new Date(this.runtime.now()));
		if (date !== this.currentDate) {
			this.currentDate = date;
			this.onDateChanged(date);
		}
		if (this.nextBoundaryAt) {
			this.scheduleNextBoundary();
			if (this.countdownTick) this.emitCountdown();
		}
		return date;
	}
	stop() {
		if (this.boundaryTimer) this.runtime.clearTimeout(this.boundaryTimer);
		this.boundaryTimer = 0;
		this.nextBoundaryAt = 0;
		this.stopCountdown();
	}
	scheduleNextBoundary() {
		if (this.boundaryTimer) this.runtime.clearTimeout(this.boundaryTimer);
		this.boundaryTimer = 0;
		const now = this.runtime.now();
		const today = dailyDate(new Date(now));
		let lower = now;
		let upper = now + 1800 * 60 * 1e3;
		while (dailyDate(new Date(upper)) === today) upper += 360 * 60 * 1e3;
		while (upper - lower > 1) {
			const middle = Math.floor((lower + upper) / 2);
			if (dailyDate(new Date(middle)) === today) lower = middle;
			else upper = middle;
		}
		this.nextBoundaryAt = upper;
		this.boundaryTimer = this.runtime.setTimeout(() => this.reconcile(), Math.max(1, upper - now));
	}
	emitCountdown() {
		if (!this.nextBoundaryAt || !this.countdownTick) return;
		if (this.countdownTimer) this.runtime.clearTimeout(this.countdownTimer);
		this.countdownTimer = 0;
		const remainingMs = Math.max(0, this.nextBoundaryAt - this.runtime.now());
		this.remainingMs = remainingMs;
		this.countdownTick();
		if (!remainingMs) return;
		const untilNextSecond = remainingMs % 1e3 || 1e3;
		this.countdownTimer = this.runtime.setTimeout(() => this.emitCountdown(), untilNextSecond);
	}
};
var CatalogLoadError = class extends Error {
	kind;
	get retryable() {
		return this.kind !== "invalid-date";
	}
	constructor(kind, message, options) {
		super(message, options);
		this.kind = kind;
		this.name = "CatalogLoadError";
	}
};
var CatalogSource = class {
	url;
	fetchCatalog;
	constructor(url, fetchCatalog = (input, init) => fetch(input, init)) {
		this.url = url;
		this.fetchCatalog = fetchCatalog;
	}
	async load(date, signal) {
		if (!isIsoDate(date)) throw new CatalogLoadError("invalid-date", `Invalid catalog date "${date}".`);
		const url = new URL(this.url);
		url.searchParams.set("date", date);
		const init = {
			cache: "no-cache",
			headers: { Accept: "application/json" }
		};
		if (signal) init.signal = signal;
		let response;
		try {
			response = await this.fetchCatalog(url, init);
		} catch (cause) {
			if (cause instanceof DOMException && cause.name === "AbortError") throw cause;
			throw new CatalogLoadError("network", "Track catalog could not be downloaded.", { cause });
		}
		if (!response.ok) throw new CatalogLoadError("http", `Track catalog returned ${response.status}.`);
		let value;
		try {
			value = await response.json();
		} catch (cause) {
			throw new CatalogLoadError("invalid-json", "Track catalog is not valid JSON.", { cause });
		}
		try {
			return validateTrackCatalog(value);
		} catch (cause) {
			throw new CatalogLoadError("invalid-catalog", cause instanceof Error ? cause.message : "Track catalog is invalid.", { cause });
		}
	}
};
var browserTiming = {
	setTimeout: (callback, delayMs) => window.setTimeout(callback, delayMs),
	clearTimeout: (handle) => window.clearTimeout(handle)
};
var AudioPlayer = class {
	sourceForRound;
	callbacks;
	timing;
	playbackTimeoutMs;
	slots;
	primarySlot = null;
	preloadSlot = null;
	generation = 0;
	lastPrimarySlotId = null;
	suspension = null;
	operation = null;
	nextOperationId = 0;
	watchdogTimer = 0;
	volume = 1;
	constructor(elements, sourceForRound, callbacks, timing = browserTiming, playbackTimeoutMs = 1e4) {
		this.sourceForRound = sourceForRound;
		this.callbacks = callbacks;
		this.timing = timing;
		this.playbackTimeoutMs = playbackTimeoutMs;
		this.slots = elements.map((element, id) => ({
			id,
			element,
			round: null,
			generation: 0,
			controller: null,
			failed: false,
			ready: false,
			hasRequestedPlayback: false
		}));
	}
	setVolume(volume) {
		this.volume = Math.min(1, Math.max(0, Number.isFinite(volume) ? volume : 1));
		for (const slot of this.slots) slot.element.volume = this.volume;
	}
	loadPrimary(round) {
		return this.assign(round, "primary");
	}
	loadPreload(round) {
		return this.assign(round, "preload");
	}
	promotePreload(round) {
		const slot = this.preloadSlot;
		if (!slot || slot.round?.id !== round.id) return false;
		const mediaError = slot.element.error;
		if (slot.failed || mediaError) {
			this.preloadSlot = null;
			slot.failed = true;
			this.releaseSlot(slot);
			return false;
		}
		this.cancelPlaybackWatchdog();
		const previous = this.primarySlot;
		this.primarySlot = slot;
		this.preloadSlot = null;
		slot.hasRequestedPlayback = false;
		this.operation = null;
		if (previous && previous !== slot) {
			this.lastPrimarySlotId = previous.id;
			this.releaseSlot(previous);
		}
		return true;
	}
	playPrimary(round, restart) {
		const slot = this.primarySlot;
		if (!slot || slot.round?.id !== round.id || slot.failed || this.suspension) return false;
		const operation = {
			id: ++this.nextOperationId,
			phase: "starting"
		};
		slot.hasRequestedPlayback = true;
		this.operation = operation;
		if (restart) {
			slot.element.pause();
			this.seek(slot);
		} else this.correctLateSeek(slot);
		let playPromise;
		try {
			playPromise = slot.element.play();
		} catch {
			if (this.isCurrentPlaybackOperation(slot, operation)) this.fail(slot, "primary-play");
			return false;
		}
		if (this.isCurrentPlaybackOperation(slot, operation)) this.startPlaybackWatchdog(slot, operation);
		playPromise?.catch((error) => {
			if (!this.isCurrentPlaybackOperation(slot, operation)) return;
			if (isNamedError(error, "AbortError")) return;
			if (isNamedError(error, "NotAllowedError")) {
				this.cancelPlaybackWatchdog(operation);
				this.operation = null;
				this.callbacks.onBlocked(round);
				return;
			}
			this.fail(slot, "primary-play");
		});
		return true;
	}
	rewindPrimary(round) {
		const slot = this.primarySlot;
		if (!slot || slot.round?.id !== round.id || slot.failed || this.suspension) return false;
		this.cancelPlaybackWatchdog();
		this.operation = null;
		slot.element.pause();
		this.seek(slot, true);
		return true;
	}
	pause() {
		this.cancelPlaybackWatchdog();
		this.operation = null;
		const primary = this.primarySlot;
		if (!primary) return;
		primary.element.pause();
	}
	releasePrimary() {
		this.cancelPlaybackWatchdog();
		this.operation = null;
		if (!this.primarySlot) return;
		const slot = this.primarySlot;
		this.lastPrimarySlotId = slot.id;
		this.primarySlot = null;
		this.suspension = null;
		this.releaseSlot(slot);
	}
	stop() {
		this.cancelPlaybackWatchdog();
		this.operation = null;
		this.generation += 1;
		this.suspension = null;
		if (this.primarySlot) {
			const primary = this.primarySlot;
			this.primarySlot = null;
			this.lastPrimarySlotId = primary.id;
			this.releaseSlot(primary);
		}
		this.discardPreload();
	}
	discardPreload() {
		if (!this.preloadSlot) return;
		const preload = this.preloadSlot;
		this.preloadSlot = null;
		this.releaseSlot(preload);
	}
	suspend() {
		if (this.suspension) return;
		this.suspension = {
			primaryFailure: null,
			preloadFailures: []
		};
		this.cancelPlaybackWatchdog();
		this.operation = null;
		for (const slot of this.slots) {
			if (!slot.round) continue;
			slot.element.pause();
		}
	}
	restore(onFailure) {
		const suspension = this.suspension;
		this.suspension = null;
		if (!suspension) return;
		for (const failure of suspension.preloadFailures) onFailure(failure);
		if (suspension.primaryFailure) onFailure(suspension.primaryFailure);
		if (this.primarySlot?.ready && !this.primarySlot.failed && this.primarySlot.round) this.callbacks.onReady?.({
			channel: "primary",
			round: this.primarySlot.round
		});
		if (this.preloadSlot?.ready && !this.preloadSlot.failed && this.preloadSlot.round) this.callbacks.onReady?.({
			channel: "preload",
			round: this.preloadSlot.round
		});
	}
	primaryStatus(round) {
		if (this.primarySlot?.round?.id !== round.id) return null;
		return {
			ready: this.primarySlot.ready,
			playRequested: Boolean(this.primarySlot && this.operation && this.isCurrentPlaybackOperation(this.primarySlot, this.operation))
		};
	}
	assign(round, channel) {
		if (channel === "primary") {
			this.cancelPlaybackWatchdog();
			this.operation = null;
		}
		const protectedSlot = channel === "primary" ? this.preloadSlot : this.primarySlot;
		const existing = channel === "primary" ? this.primarySlot : this.preloadSlot;
		if (existing?.round?.id === round.id && !existing.failed) return true;
		if (existing) {
			if (channel === "primary") this.primarySlot = null;
			else this.preloadSlot = null;
			this.releaseSlot(existing);
		}
		const candidates = this.slots.filter((slot) => slot !== protectedSlot);
		const slot = candidates.find((candidate) => candidate.id !== this.lastPrimarySlotId) ?? candidates[0] ?? null;
		if (!slot) return false;
		if (slot.round) this.releaseSlot(slot);
		slot.round = round;
		slot.generation = ++this.generation;
		slot.failed = false;
		slot.ready = false;
		slot.hasRequestedPlayback = false;
		if (channel === "primary") this.primarySlot = slot;
		else this.preloadSlot = slot;
		this.bind(slot);
		slot.element.preload = "auto";
		slot.element.src = this.sourceForRound(round);
		slot.element.load();
		if (slot.element.error) {
			this.fail(slot, channel === "primary" ? "primary-load" : "preload-load");
			return false;
		}
		if (slot.element.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA) this.markReady(slot);
		return true;
	}
	bind(slot) {
		const controller = new AbortController();
		const generation = slot.generation;
		const round = slot.round;
		slot.controller = controller;
		if (!round) return;
		const live = () => this.isLive(slot, generation, round.id);
		slot.element.addEventListener("loadedmetadata", () => {
			if (live()) this.seek(slot);
		}, { signal: controller.signal });
		slot.element.addEventListener("canplay", () => {
			if (live()) this.markReady(slot);
		}, { signal: controller.signal });
		slot.element.addEventListener("canplaythrough", () => {
			if (live()) this.markReady(slot);
		}, { signal: controller.signal });
		slot.element.addEventListener("progress", () => {
			if (live() && slot.element.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA) this.markReady(slot);
		}, { signal: controller.signal });
		slot.element.addEventListener("seeked", () => {
			if (live() && slot.element.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA) this.markReady(slot);
		}, { signal: controller.signal });
		slot.element.addEventListener("playing", () => {
			if (!live() || slot !== this.primarySlot || this.suspension) return;
			if (!this.operation || !this.isCurrentPlaybackOperation(slot, this.operation)) return;
			this.correctLateSeek(slot);
			const operation = this.operation;
			this.cancelPlaybackWatchdog(operation);
			this.operation = {
				...operation,
				phase: "playing"
			};
			this.markReady(slot);
			this.callbacks.onPlaying(round);
		}, { signal: controller.signal });
		slot.element.addEventListener("timeupdate", () => {
			if (!live() || slot !== this.primarySlot || !this.operation || this.suspension) return;
			this.correctLateSeek(slot);
		}, { signal: controller.signal });
		const wait = () => {
			if (!live() || slot !== this.primarySlot || this.suspension) return;
			const operation = this.operation;
			if (!operation || !this.isCurrentPlaybackOperation(slot, operation)) return;
			const wasPlaying = operation.phase === "playing";
			if (operation.phase === "buffering") return;
			const buffering = {
				...operation,
				phase: "buffering"
			};
			this.operation = buffering;
			if (wasPlaying) this.startPlaybackWatchdog(slot, buffering);
			this.callbacks.onWaiting(round);
		};
		slot.element.addEventListener("waiting", wait, { signal: controller.signal });
		slot.element.addEventListener("stalled", wait, { signal: controller.signal });
		slot.element.addEventListener("ended", () => {
			if (!live() || slot !== this.primarySlot || this.suspension) return;
			const operation = this.operation;
			if (!operation || !this.isCurrentPlaybackOperation(slot, operation)) return;
			this.cancelPlaybackWatchdog(operation);
			this.operation = null;
			this.callbacks.onEnded(round);
		}, { signal: controller.signal });
		slot.element.addEventListener("error", () => {
			if (!live() || !slot.element.error) return;
			const stage = (slot === this.preloadSlot ? "preload" : "primary") === "preload" ? "preload-load" : slot.hasRequestedPlayback ? "primary-play" : "primary-load";
			this.fail(slot, stage);
		}, { signal: controller.signal });
	}
	markReady(slot) {
		if (slot.ready || slot.failed || !slot.round) return;
		slot.ready = true;
		this.seek(slot);
		if (!this.suspension) this.callbacks.onReady?.({
			channel: slot === this.preloadSlot ? "preload" : "primary",
			round: slot.round
		});
	}
	fail(slot, stage) {
		if (slot.failed || !slot.round) return;
		slot.failed = true;
		const failure = {
			stage,
			round: slot.round
		};
		if (stage === "preload-load") {
			if (this.preloadSlot === slot) this.preloadSlot = null;
			this.releaseSlot(slot);
			this.emitFailure(failure);
			return;
		}
		this.cancelPlaybackWatchdog();
		this.operation = null;
		this.emitFailure(failure);
	}
	emitFailure(failure) {
		if (!this.suspension) {
			this.callbacks.onFailure(failure);
			return;
		}
		if (failure.stage === "preload-load") this.suspension.preloadFailures.push(failure);
		else this.suspension.primaryFailure = failure;
	}
	startPlaybackWatchdog(slot, operation) {
		this.cancelPlaybackWatchdog();
		this.watchdogTimer = this.timing.setTimeout(() => {
			if (!this.isCurrentPlaybackOperation(slot, operation) || !this.operation || !["starting", "buffering"].includes(this.operation.phase)) return;
			this.watchdogTimer = 0;
			this.fail(slot, "primary-play");
		}, this.playbackTimeoutMs);
	}
	cancelPlaybackWatchdog(operation) {
		if (operation && !samePlaybackOperation(this.operation, operation)) return;
		if (this.watchdogTimer) this.timing.clearTimeout(this.watchdogTimer);
		this.watchdogTimer = 0;
	}
	seek(slot, force = false) {
		if (!slot.round || slot.element.readyState < HTMLMediaElement.HAVE_METADATA || !force && slot.element.seeking) return;
		try {
			slot.element.currentTime = this.targetTime(slot);
		} catch {}
	}
	targetTime(slot) {
		if (!slot.round) return 0;
		return Math.min(slot.round.clipStart, Math.max(0, slot.element.duration - .05));
	}
	correctLateSeek(slot) {
		if (!slot.round || slot.element.readyState < HTMLMediaElement.HAVE_METADATA) return;
		if (slot.element.currentTime + .35 < slot.round.clipStart) this.seek(slot);
	}
	isLive(slot, generation, roundId) {
		return slot.generation === generation && (slot === this.primarySlot || slot === this.preloadSlot) && slot.round?.id === roundId;
	}
	isCurrentPlaybackOperation(slot, operation) {
		return slot === this.primarySlot && samePlaybackOperation(this.operation, operation);
	}
	releaseSlot(slot) {
		const replaceFailedElement = slot.failed;
		slot.controller?.abort();
		slot.controller = null;
		const element = slot.element;
		element.pause();
		element.removeAttribute("src");
		element.load();
		if (replaceFailedElement) {
			const replacement = element.cloneNode(false);
			replacement.volume = this.volume;
			element.replaceWith(replacement);
			slot.element = replacement;
		}
		slot.round = null;
		slot.failed = false;
		slot.ready = false;
		slot.hasRequestedPlayback = false;
	}
};
function isNamedError(error, name) {
	return typeof error === "object" && error !== null && "name" in error && error.name === name;
}
function samePlaybackOperation(left, right) {
	return left?.id === right.id;
}
function emptyRounds(previous = null) {
	return {
		current: null,
		next: null,
		failed: /* @__PURE__ */ new Set(),
		previous,
		currentFailures: 0,
		nextFailures: 0,
		exhausted: false
	};
}
function attempts(state) {
	switch (state.run.mode) {
		case "daily": return state.player.daily?.date === state.run.date ? state.player.daily.attempts : [];
		case "classic": return state.run.finished?.challenge.attempts ?? state.player.classic?.attempts ?? [];
		case "blitz":
		case "gauntlet": return state.run.attempts;
		default: return [];
	}
}
function finished(run) {
	return run.mode === null ? false : run.mode === "daily" ? run.completed : run.finished !== null;
}
function timed(mode) {
	return mode === "blitz" || mode === "gauntlet";
}
function puzzle(mode) {
	return mode === "daily" || mode === "classic";
}
function found(attempts) {
	return new Set(attempts.filter((a) => a.outcome === "correct" && a.trackNumber !== null).map((a) => a.trackNumber));
}
function puzzleAnswer(previous, answer) {
	const attempts = [answer, ...previous];
	return {
		attempts,
		complete: answer.outcome === "correct" || attempts.length === 6,
		snippetMs: snippetSeconds(attempts.length) * 1e3
	};
}
function blitzAnswer(previous, answer) {
	return [answer, ...previous];
}
function gauntletAnswer(previous, answer, catalogCount) {
	const attempts = [answer, ...previous];
	const found = new Set(attempts.filter((a) => a.outcome === "correct").map((a) => a.trackNumber));
	const complete = answer.outcome === "correct" && found.size === catalogCount;
	return {
		attempts,
		complete,
		adjustmentMs: complete ? 0 : answer.outcome === "correct" ? 3e3 : answer.outcome === "wrong" ? -1e3 : -2e3
	};
}
function selectedSecond(second, round) {
	return Math.max(0, Math.min(Math.floor(round.track.duration), Math.round(second)));
}
function seekAnswer(round, second) {
	return {
		trackNumber: round.track.dailyNumber,
		trackDuration: round.track.duration,
		guessedSecond: selectedSecond(second, round),
		actualSecond: Math.round(round.clipStart)
	};
}
function newRun(mode, date, state) {
	switch (mode) {
		case "daily": return {
			mode,
			date,
			engaged: false,
			completed: false
		};
		case "classic": return {
			mode,
			engaged: false,
			resumeChoice: state.player.classic !== null,
			finished: null
		};
		case "blitz":
		case "gauntlet": return {
			mode,
			engaged: false,
			attempts: [],
			finished: null
		};
		case "seek": return {
			mode,
			engaged: false,
			answers: [],
			phase: {
				kind: "selecting",
				second: null
			},
			finished: null
		};
	}
}
function dailyUnavailable(state) {
	if (state.run.mode !== "daily") return false;
	const saved = state.player.daily;
	if (saved?.date === state.run.date && !puzzleDone(saved.attempts)) return !isDailyTrackAvailable(state.catalog, state.run.date, saved.dailyNumber);
	return !selectDailyTrack([...state.catalog], state.run.date, null);
}
function puzzleDone(values) {
	return values[0]?.outcome === "correct" || values.length === 6;
}
function snippet(state) {
	return state.run.mode === "seek" ? 8 : snippetSeconds(Math.min(5, attempts(state).length));
}
function validClassic(state) {
	const saved = state.player.classic;
	const track = state.catalog.find((t) => t.dailyNumber === saved?.dailyNumber);
	return !!saved && !!track && saved.clipStart <= maximumClipStart(track, 32);
}
function chooseRound(state, id, avoid, random) {
	const { run, catalog, player, rounds } = state;
	if (run.mode === null) return null;
	if (run.mode === "daily") {
		if (dailyUnavailable(state)) return null;
		const saved = player.daily?.date === run.date ? player.daily : null;
		const track = selectDailyTrack([...catalog], run.date, saved?.dailyNumber ?? null);
		return track ? {
			id,
			track,
			clipStart: dailyClipStart(track, run.date)
		} : null;
	}
	if (run.mode === "classic" && player.classic) {
		const track = catalog.find((t) => t.dailyNumber === player.classic.dailyNumber);
		return track ? {
			id,
			track,
			clipStart: player.classic.clipStart
		} : null;
	}
	const excluded = new Set(rounds.failed);
	if (run.mode === "seek") for (const answer of run.answers) excluded.add(answer.trackNumber);
	const track = selectRandomTrack([...catalog], excluded, avoid, random);
	const seconds = run.mode === "seek" ? 8 : run.mode === "classic" ? 32 : 60;
	return track ? {
		id,
		track,
		clipStart: randomClipStart(track, seconds, random)
	} : null;
}
function complete(state, elapsedMs) {
	const run = state.run;
	const records = state.player.records;
	switch (run.mode) {
		case null: return;
		case "daily":
			run.completed = true;
			return;
		case "classic": {
			const challenge = state.player.classic;
			if (!challenge) throw new Error("Classic completion requires its challenge");
			const result = updateClassicBest(records, challenge.attempts[0]?.outcome === "correct", challenge.attempts.length - 1);
			run.finished = {
				challenge,
				newPersonalBest: result.newPersonalBest,
				streak: result.streak,
				average: result.average
			};
			state.player.classic = null;
			return;
		}
		case "blitz": {
			const correct = run.attempts.filter((a) => a.outcome === "correct").length;
			run.finished = { newPersonalBest: updateBlitzBest(records, correct, accuracy(correct, run.attempts.length)) };
			return;
		}
		case "gauntlet": {
			const time = Math.floor(elapsedMs / 1e3) * 1e3;
			run.finished = {
				elapsedMs: time,
				newPersonalBest: updateGauntletBest(records, found(run.attempts).size >= state.catalog.length, time, state.catalog.length)
			};
			return;
		}
		case "seek":
			run.finished = { newPersonalBest: updateSeekBest(records, seekScore(run.answers)) };
			return;
	}
}
function dailyCompleted(progress, date) {
	return progress !== null && progress.date === date && puzzleCompleted(progress.attempts);
}
function dailyWon(progress, date) {
	return dailyCompleted(progress, date) && progress?.attempts[0]?.outcome === "correct";
}
function dailyAttempt(progress) {
	if (!progress) return 0;
	return puzzleCompleted(progress.attempts) ? Math.max(0, progress.attempts.length - 1) : progress.attempts.length;
}
function emptyPersonalBests() {
	return {
		classic: {
			current: 0,
			best: 0,
			snippetTotal: 0,
			bestSnippetTotal: 0
		},
		blitz: {
			score: 0,
			accuracy: null
		},
		seek: { score: 0 },
		gauntlet: {
			timeMs: 0,
			trackCount: 0
		}
	};
}
function composeClockViewModel(input) {
	const { mode, clock } = input;
	if (!mode) return {
		currentText: "0:00",
		endText: "0:01",
		progress: 0
	};
	const display = clockDisplayForMode(mode);
	switch (display) {
		case "snippet": {
			if (input.snippetSeconds === null) throw new Error(`Snippet clock requires a snippet duration for ${mode}`);
			const seconds = clock.elapsedMs / 1e3;
			return {
				currentText: formatClock(seconds),
				endText: `0:${String(input.snippetSeconds).padStart(2, "0")}`,
				progress: seconds ? seconds / maxPuzzleSnippetSeconds + .0025 : 0
			};
		}
		case "countdown": {
			const initial = modeRules[mode].initialTimeMs;
			return {
				currentText: formatClock(clock.remainingMs / 1e3),
				endText: formatClock(initial / 1e3),
				progress: initial ? clock.remainingMs / initial : 0
			};
		}
		case "elapsed": return {
			currentText: formatClock(clock.elapsedMs / 1e3),
			endText: formatClock(Math.ceil(clock.remainingMs / 1e3)),
			progress: clock.maxRemainingMs ? clock.remainingMs / clock.maxRemainingMs : 0
		};
		case "position": return {
			currentText: "0:00",
			endText: "?:??",
			progress: 0
		};
		default: throw new Error(`Unsupported clock display: ${String(display)}`);
	}
}
function formatClock(seconds) {
	const safe = Math.max(0, seconds);
	return `${Math.floor(safe / 60)}:${String(Math.floor(safe) % 60).padStart(2, "0")}`;
}
function composeResultViewModel(result, persistenceFailed, attempts = []) {
	if (!result) return null;
	const outcome = resultOutcome(result, attempts);
	const modules = resultModules(result);
	const announcement = announceResult(outcome, modules);
	const daily = result.mode === "daily";
	return {
		mode: result.mode,
		outcome,
		primaryLabel: daily ? "CLOSE" : "NEW GAME",
		modules,
		announcement: persistenceFailed ? `${announcement} PROGRESS COULD NOT BE SAVED IN THIS BROWSER.` : announcement,
		secondary: daily ? {
			action: "share",
			label: "SHARE",
			ariaLabel: "SHARE DAILY RESULT"
		} : result.mode === "classic" && result.spotify ? {
			action: "spotify",
			label: "SPOTIFY",
			ariaLabel: "OPEN RESULT TRACK ON SPOTIFY"
		} : null
	};
}
function resultModules(result) {
	if (result.mode === "daily") return [trackModule(result.trackTitle), runModule("TODAY'S SCORE", [formatAttempts(result.attempts), "ATTEMPTS"])];
	if (result.mode === "classic") {
		const run = [String(result.streak), `AVERAGE SNIPPET ${formatAverage(result.average)}`];
		return [trackModule(result.trackTitle), runModule(result.won ? "CURRENT STREAK" : "STREAK ENDED", run, result.newPersonalBest)];
	}
	if (result.mode === "blitz") return [runModule("RUN SCORE", [
		String(result.correct),
		"CORRECT GUESSES",
		`${formatAccuracy(result.accuracy)} SUCCESS RATE`
	], result.newPersonalBest)];
	if (result.mode === "seek") return [runModule("RUN SCORE", [formatSeekScore(seekResultScore(result)), `/ ${seekMaxScore.toLocaleString("en-US")} POINTS`], result.newPersonalBest), {
		kind: "recap",
		label: "ROUND RECAP",
		items: result.rounds.map((round) => ({
			meta: `ROUND ${round.round} · ${round.points.toLocaleString("en-US")} POINTS`,
			title: round.trackTitle
		}))
	}];
	if (result.mode === "gauntlet") return [runModule("RUN TIME", [formatClock(result.elapsedMs / 1e3), `${result.completedTracks} / ${result.catalogTrackCount} TRACKS`], result.newPersonalBest)];
	throw new Error(`Unsupported result mode: ${String(result.mode)}`);
}
function announceResult(outcome, modules) {
	return `${outcome}. ${modules.map((module) => module.kind === "recap" ? `${module.label}. ${module.items.map((item) => `${item.meta}. ${item.title}`).join(". ")}` : `${module.label}. ${resultModuleValue(module)}`).join(". ")}`.trim();
}
function resultOutcome(result, attempts) {
	if (result.mode === "daily" || result.mode === "classic") return puzzleResultMessage(result, attempts);
	if (result.mode === "blitz") return "TIME IS UP";
	if (result.mode === "seek") return "RUN COMPLETE";
	if (result.mode === "gauntlet") return gauntletCompleted(result) ? "YOU SURVIVED" : "TIME IS UP";
	throw new Error(`Unsupported result mode: ${String(result.mode)}`);
}
function puzzleResultMessage(result, attempts) {
	if (result.mode !== "daily" && result.mode !== "classic") return "";
	if (result.won) return "YOU GOT IT";
	return attempts[0]?.outcome === "skip" ? "YOU GAVE UP" : "YOU GOT IT ALL WRONG";
}
function formatAccuracy(value) {
	return Number.isSafeInteger(value) ? `${value}%` : "--";
}
function formatAttempts(value) {
	return `${value || "--"} / ${puzzleAttemptCount}`;
}
function formatAverage(value) {
	if (!Number.isFinite(value) || value <= 0) return "--";
	const rounded = Math.round(value * 10) / 10;
	return `${Number.isInteger(rounded) ? rounded : rounded.toFixed(1)}s`;
}
function formatSeekScore(value) {
	return value.toLocaleString("en-US");
}
function trackModule(value) {
	return {
		kind: "track",
		label: "TRACK",
		value
	};
}
function runModule(label, lines, newPersonalBest = false) {
	return {
		kind: "run",
		label: newPersonalBest ? "NEW PERSONAL BEST" : label,
		lines,
		...newPersonalBest ? { newPersonalBest: true } : {}
	};
}
function resultModuleValue(module) {
	return module.kind === "run" ? module.lines.join(" · ") : module.value;
}
function resultFor(state) {
	const { run, rounds } = state;
	if (!finished(run)) return null;
	const values = attempts(state);
	const track = rounds.current?.round.track;
	switch (run.mode) {
		case "daily": return track ? {
			mode: "daily",
			won: values[0]?.outcome === "correct",
			trackTitle: track.title,
			spotify: track.spotify,
			attempts: values.length
		} : null;
		case "classic": return track && run.finished ? {
			mode: "classic",
			won: values[0]?.outcome === "correct",
			trackTitle: track.title,
			spotify: track.spotify,
			newPersonalBest: run.finished.newPersonalBest,
			streak: run.finished.streak,
			average: run.finished.average
		} : null;
		case "blitz": {
			const correct = values.filter((a) => a.outcome === "correct").length;
			return {
				mode: "blitz",
				correct,
				accuracy: accuracy(correct, values.length),
				newPersonalBest: run.finished.newPersonalBest
			};
		}
		case "gauntlet": return {
			mode: "gauntlet",
			completedTracks: found(values).size,
			catalogTrackCount: state.catalog.length,
			elapsedMs: run.finished.elapsedMs,
			newPersonalBest: run.finished.newPersonalBest
		};
		case "seek": return {
			mode: "seek",
			newPersonalBest: run.finished.newPersonalBest,
			rounds: [...run.answers].reverse().map((a, i) => ({
				round: i + 1,
				points: seekAttemptPoints(a),
				trackTitle: state.catalog.find((t) => t.dailyNumber === a.trackNumber).title
			}))
		};
		default: return null;
	}
}
function present(state, facts) {
	const { run, player, rounds } = state;
	const mode = run.mode;
	const round = rounds.current?.phase !== "prepared" ? rounds.current?.round ?? null : null;
	const retry = rounds.current?.phase === "retry" || rounds.exhausted;
	const values = attempts(state);
	const completed = finished(run);
	const date = run.mode === "daily" ? run.date : facts.date;
	const doneDaily = mode === "daily" && dailyCompleted(player.daily, date);
	const attempt = Math.min(5, completed || doneDaily ? Math.max(0, values.length - 1) : values.length);
	const overlay = state.overlay.kind === "none" ? null : state.overlay.kind;
	const appStatus = state.catalogPhase === "ready" ? mode ? "ready" : "awaiting-mode" : state.catalogPhase === "error" ? "error" : "loading";
	const unavailable = mode === "daily" && dailyUnavailable(state);
	const ready = appStatus === "ready" && !overlay && !facts.loading;
	const heard = rounds.current?.phase === "heard";
	const interact = ready && heard && !retry && !completed;
	const inputVisible = mode !== "seek" && !!round && !completed && !retry;
	const resume = run.mode === "classic" && run.resumeChoice;
	const selecting = run.mode !== "seek" || run.phase.kind === "selecting";
	const duration = timed(mode) ? null : mode === "seek" ? 8 : snippetSeconds(attempt);
	const result = resultFor(state);
	let rules = mode ? modeRules[mode].description : copy.modePrompt;
	if (appStatus === "error") rules = copy.catalogError;
	else if (doneDaily) {
		const remaining = Math.max(0, Math.ceil(facts.countdown / 1e3));
		const count = [
			Math.floor(remaining / 3600),
			Math.floor(remaining / 60) % 60,
			remaining % 60
		].map((n) => String(n).padStart(2, "0")).join(":");
		rules = `${dailyWon(player.daily, date) ? "COMPLETED" : "FAILED"} IN ${values.length} ATTEMPT${values.length === 1 ? "" : "S"}, COME BACK IN ${count}`;
	} else if (appStatus === "loading") rules = state.catalogPhase === "loading" ? copy.loadingCatalog : copy.modePrompt;
	else if (resume) rules = "PRESS PLAY TO CONTINUE OR GIVE UP THE CURRENT ROUND";
	else if (retry) rules = copy.trackError;
	else if (run.mode === "seek") {
		if (run.phase.kind !== "selecting" && run.answers[0]) rules = seekFeedback(run.answers[0]).join(" · ");
		else if (round) rules = "PLACE YOUR GUESS ON THE TIMELINE";
	} else if (mode === "daily") {
		if (unavailable) rules = copy.trackUnavailable;
		else if (player.daily?.date === date) rules = `DAILY IN PROGRESS, CONTINUE FROM ATTEMPT ${values.length + 1}`;
	}
	const milestones = /* @__PURE__ */ new Set();
	const seen = /* @__PURE__ */ new Set();
	if (mode === "gauntlet") for (let i = values.length - 1; i >= 0; i--) {
		const a = values[i];
		if (a.outcome === "correct" && a.trackNumber !== null && !seen.has(a.trackNumber)) {
			seen.add(a.trackNumber);
			milestones.add(values.length - i);
		}
	}
	let slots = (timed(mode) ? values.slice(0, 19) : values).map((a, i) => {
		const ordinal = values.length - i;
		let text = state.catalog.find((t) => t.dailyNumber === a.trackNumber)?.title ?? `TRACK #${a.trackNumber}`;
		if (a.outcome === "skip") {
			const added = ordinal < 6 ? snippetDurations[ordinal] - snippetDurations[ordinal - 1] : 0;
			text = timed(mode) ? "SKIPPED" : ordinal === 6 ? "FINAL GUESS SKIPPED" : `GUESS ${ordinal} SKIPPED, ${added} SECOND${added === 1 ? "" : "S"} ADDED`;
		}
		return {
			id: ordinal,
			text,
			tone: a.outcome,
			...milestones.has(ordinal) ? { gauntletMilestone: true } : {}
		};
	});
	let head = null;
	if (timed(mode) && run.mode !== null && run.engaged) {
		const left = Math.max(0, state.catalog.length - found(values).size);
		head = {
			id: values.length + 1,
			text: completed ? mode === "gauntlet" && left === 0 ? "GAUNTLET COMPLETE" : "TIME'S UP" : mode === "gauntlet" ? `${left} ${left === 1 ? "TRACK" : "TRACKS"} LEFT` : `GUESS #${values.length + 1}`,
			tone: completed ? "neutral" : "prompt"
		};
	} else if (puzzle(mode) && !completed && !doneDaily && (round || values.length)) head = {
		id: attempt + 1,
		text: attempt === 5 ? "LAST CHANCE TO GUESS" : `GUESS ${attempt + 1} OUT OF 6`,
		tone: attempt === 5 ? "final-prompt" : "prompt"
	};
	if (retry && head) head = {
		...head,
		text: copy.trackError,
		tone: "technical"
	};
	if (head) slots.unshift(head);
	if (run.mode === "seek") {
		const prior = run.phase.kind === "selecting" ? run.answers : run.answers.slice(1);
		slots = prior.map((a, i) => ({
			id: prior.length - i,
			text: `ROUND ${prior.length - i} · ${seekAttemptPoints(a)} POINTS`,
			tone: "neutral"
		}));
		if (run.engaged) {
			const number = run.answers.length + (run.phase.kind === "selecting" ? 1 : 0);
			slots.unshift({
				id: number,
				text: `ROUND ${number} OUT OF 5`,
				tone: "prompt"
			});
		}
	}
	const seekAction = run.mode === "seek" && run.phase.kind === "revealed";
	return {
		appStatus,
		mode,
		rulesText: rules,
		transportText: facts.loading ? copy.loadingTrack : "",
		inputVisible,
		playEnabled: ready && !!mode && !completed && !doneDaily && !unavailable && selecting,
		attemptEnabled: interact && inputVisible,
		actionEnabled: resume ? ready : run.mode === "seek" ? ready && !completed && (seekAction || interact && selecting && run.phase.kind === "selecting" && run.phase.second !== null) : interact && inputVisible,
		playbackIcon: facts.requested ? timed(mode) ? "pause" : "stop" : "play",
		snippetSeconds: duration,
		skipText: resume ? "GIVE UP" : run.mode === "seek" ? seekAction ? run.answers.length >= 5 ? "RESULTS" : "NEXT" : "GUESS" : skipLabel(mode, attempt),
		slots,
		unavailableGuessIds: new Set(puzzle(mode) ? values.flatMap((a) => a.trackNumber === null ? [] : [a.trackNumber]) : []),
		clock: composeClockViewModel({
			mode,
			snippetSeconds: duration,
			clock: facts.clock
		}),
		positionTimeline: run.mode === "seek" && round ? {
			roundId: round.id,
			phase: run.phase.kind,
			maximumSecond: Math.floor(round.track.duration),
			selectedSecond: run.phase.kind === "selecting" ? run.phase.second : run.answers[0]?.guessedSecond ?? null,
			actualSecond: run.phase.kind === "selecting" ? null : run.answers[0]?.actualSecond ?? null,
			interactionEnabled: interact && selecting
		} : null,
		result: composeResultViewModel(result, facts.unsaved, values),
		dailyProgress: player.daily,
		personalBests: player.records,
		dailyDate: date,
		discoveries: new Set(player.discoveries),
		tracks: state.catalog,
		overlay
	};
}
var Application = class {
	options;
	state;
	clock;
	audio;
	calendar;
	queue = [];
	processing = false;
	nextRound = 0;
	nextClose = 0;
	loadingTimer = 0;
	loadingGeneration = 0;
	loading = false;
	calendarDate;
	volumeWarning = false;
	focusAfterTransition = null;
	random;
	constructor(options) {
		this.options = options;
		this.random = options.random ?? Math.random;
		this.state = {
			player: options.storage.load(),
			catalog: [],
			catalogPhase: "quiet",
			run: { mode: null },
			rounds: emptyRounds(),
			overlay: { kind: "none" },
			visible: !document.hidden,
			epoch: 0
		};
		this.calendar = new DailySchedule((date) => this.dispatch({
			type: "day",
			date
		}));
		this.calendarDate = this.calendar.current();
		this.clock = new GameClock({
			onTick: () => {
				if (this.state.run.mode !== "seek") options.view.renderClock(this.viewModel().clock);
			},
			onExpired: () => this.dispatch({ type: "expired" })
		});
		this.audio = new AudioPlayer(options.view.audioElements, options.audioUrl, {
			onReady: (event) => this.dispatch({
				type: "ready",
				event
			}),
			onPlaying: (round) => this.dispatch({
				type: "playing",
				round
			}),
			onWaiting: (round) => this.dispatch({
				type: "waiting",
				round
			}),
			onBlocked: (round) => this.dispatch({
				type: "blocked",
				round
			}),
			onEnded: (round) => this.dispatch({
				type: "ended",
				round
			}),
			onFailure: (failure) => this.dispatch({
				type: "failed",
				failure
			})
		});
		this.audio.setVolume(this.state.player.volume / 100);
		options.view.bind({
			selectMode: (mode) => this.dispatch({
				type: "mode",
				mode
			}),
			play: () => this.dispatch({ type: "play" }),
			playbackShortcut: () => this.dispatch({ type: "play" }),
			skip: () => this.dispatch({ type: "skip" }),
			guess: (trackId) => this.dispatch({
				type: "guess",
				trackId
			}),
			selectPositionSecond: (second) => this.dispatch({
				type: "position",
				second
			}),
			positionRevealComplete: (roundId) => this.dispatch({
				type: "reveal",
				roundId
			}),
			openDiscovery: () => this.dispatch({ type: "progress" }),
			closeDiscovery: () => this.dispatch({ type: "close-progress" }),
			startGauntlet: () => this.dispatch({ type: "gauntlet" }),
			resultAction: () => this.dispatch({ type: "close-result" }),
			discoveryClosed: (id) => this.dispatch({
				type: "closed",
				id
			}),
			resultClosed: (id) => this.dispatch({
				type: "closed",
				id
			}),
			setVolume: (value, committed) => this.dispatch({
				type: "volume",
				value,
				committed
			}),
			openSpotify: () => this.dispatch({ type: "spotify" }),
			openDiscoverySpotify: (trackId) => this.dispatch({
				type: "spotify",
				trackId
			}),
			shareDaily: () => this.dispatch({ type: "share" })
		});
	}
	start() {
		this.render();
		const source = new CatalogSource(this.options.catalogUrl);
		const load = () => {
			const notice = window.setTimeout(() => this.dispatch({
				type: "catalog-status",
				phase: "loading"
			}), 2e3);
			source.load(this.calendarDate).then((tracks) => {
				window.clearTimeout(notice);
				this.dispatch({
					type: "catalog",
					tracks
				});
			}, (error) => {
				window.clearTimeout(notice);
				this.dispatch({
					type: "catalog-status",
					phase: "error"
				});
				if (!(error && typeof error === "object" && "retryable" in error && error.retryable === false)) window.setTimeout(load, 5e3);
			});
		};
		load();
		document.addEventListener("visibilitychange", () => this.dispatch({ type: document.hidden ? "hidden" : "visible" }));
		window.addEventListener("pageshow", () => {
			if (!document.hidden) this.dispatch({ type: "visible" });
		});
	}
	dispatch(event) {
		this.queue.push(event);
		if (this.processing) return;
		this.processing = true;
		try {
			while (this.queue.length) this.update(this.queue.shift());
			this.render();
			const focus = this.focusAfterTransition;
			this.focusAfterTransition = null;
			if (focus === "play") this.options.view.focusPlay();
			else if (focus === "mode") this.options.view.focusAfterModeSelected();
			else if (focus === "progress") this.options.view.focusProgress();
		} finally {
			this.processing = false;
		}
	}
	update(event) {
		const s = this.state;
		const run = s.run;
		const current = s.rounds.current;
		switch (event.type) {
			case "catalog":
				if (s.catalogPhase === "ready") return;
				s.catalog = Object.freeze(event.tracks.map((track) => Object.freeze({ ...track })));
				s.catalogPhase = "ready";
				this.validateRestore();
				this.prime();
				this.render();
				if (s.overlay.kind === "none") this.options.view.focusAfterCatalogReady();
				return;
			case "catalog-status":
				if (s.catalogPhase === "ready") return;
				s.catalogPhase = event.phase;
				this.options.view.announce(event.phase === "error" ? copy.catalogError : copy.loadingCatalog);
				return;
			case "mode":
				if (s.overlay.kind !== "none" || run.mode === event.mode || s.catalogPhase === "error" && !s.catalog.length) return;
				if (event.mode === "gauntlet") return;
				this.reset(event.mode);
				this.render();
				this.options.view.announce(modeRules[event.mode].description);
				this.options.view.focusAfterModeSelected();
				return;
			case "play":
				this.play();
				return;
			case "guess": {
				if (!this.viewModel().attemptEnabled || run.mode === "seek") return;
				if (puzzle(run.mode) && attempts(s).some((a) => a.trackNumber === event.trackId)) return;
				const track = s.catalog.find((t) => t.dailyNumber === event.trackId);
				if (track && current) this.answer({
					outcome: track.dailyNumber === current.round.track.dailyNumber ? "correct" : "wrong",
					trackNumber: track.dailyNumber
				});
				return;
			}
			case "skip":
				if (run.mode === "classic" && run.resumeChoice && this.viewModel().actionEnabled) {
					s.player.classic = null;
					updateClassicBest(s.player.records, false, 0);
					this.save();
					this.reset("classic");
					this.options.view.announce("PREVIOUS CLASSIC ROUND FORFEITED.");
				} else if (run.mode === "seek") this.seekAction();
				else if (this.viewModel().actionEnabled) this.answer({
					outcome: "skip",
					trackNumber: null
				});
				return;
			case "position":
				if (run.mode === "seek" && run.phase.kind === "selecting" && current && this.viewModel().positionTimeline?.interactionEnabled && Number.isFinite(event.second)) run.phase.second = selectedSecond(event.second, current.round);
				return;
			case "reveal":
				if (run.mode === "seek" && run.phase.kind === "revealing" && current?.round.id === event.roundId) {
					run.phase = { kind: "revealed" };
					this.render();
					this.options.view.announce(`${seekFeedback(run.answers[0]).join(". ")}.`);
					this.options.view.focusAttemptAction();
				}
				return;
			case "ready":
				if (!this.unblocked()) return;
				if (event.event.channel === "primary" && current?.round.id === event.event.round.id) this.prefetch();
				if (event.event.channel === "preload" && s.rounds.next?.id === event.event.round.id) s.rounds.nextFailures = 0;
				return;
			case "playing":
				if (!this.unblocked() || !current || current.round.id !== event.round.id || finished(run)) return;
				if (current.phase !== "pending" && current.phase !== "heard") return;
				if (current.phase === "pending") {
					current.phase = "heard";
					if (run.mode !== "daily") s.rounds.previous = current.round.track.dailyNumber;
					if (run.mode !== "daily" && run.mode !== "classic") s.rounds.failed.clear();
					if (!timed(run.mode)) this.clock.restart(snippet(s) * 1e3);
				}
				s.rounds.currentFailures = 0;
				s.rounds.exhausted = false;
				this.clearLoading();
				this.clock.start();
				this.prefetch();
				this.render();
				this.options.view.focusGuess();
				return;
			case "waiting":
				if (current?.round.id !== event.round.id || !this.unblocked()) return;
				this.clock.pause();
				if (!this.loadingTimer && !this.loading) this.notice(current.round);
				return;
			case "blocked":
				if (current?.round.id !== event.round.id || !this.unblocked()) return;
				this.clearLoading();
				this.clock.pause();
				this.options.view.announce("PRESS PLAY TO START THE AUDIO.");
				this.render();
				this.options.view.focusPlay();
				return;
			case "ended":
				if (current?.phase !== "heard" || current.round.id !== event.round.id || !this.unblocked() || finished(run)) return;
				this.clearLoading();
				this.clock.pause();
				if (timed(run.mode)) this.answer({
					outcome: "skip",
					trackNumber: null
				});
				return;
			case "failed":
				this.failure(event.failure, event.restored ?? false);
				return;
			case "recover":
				if (event.epoch !== s.epoch || !this.unblocked() || finished(s.run)) return;
				if (event.play) this.startRound();
				else this.prime();
				return;
			case "loading":
				if (event.generation === this.loadingGeneration && current?.round.id === event.id && this.requested()) {
					this.loadingTimer = 0;
					this.loading = true;
					this.options.view.announce(copy.loadingTrack);
				}
				return;
			case "expired":
				if (finished(run) || !current || this.clock.snapshot().remainingMs > 0) return;
				if (timed(run.mode)) this.finish();
				else {
					this.audio.pause();
					this.clearLoading();
				}
				return;
			case "progress":
				if (s.overlay.kind === "discovery") {
					this.close("resume");
					return;
				}
				if (s.overlay.kind !== "none") return;
				this.clock.pause();
				this.clearLoading();
				this.audio.suspend();
				s.overlay = {
					kind: "discovery",
					closing: null
				};
				return;
			case "close-progress":
				if (s.overlay.kind === "discovery") this.close("resume");
				return;
			case "gauntlet":
				if (s.overlay.kind === "discovery" && summarizeDiscovery(s.catalog, new Set(s.player.discoveries)).complete) this.close("start-gauntlet");
				return;
			case "close-result":
				if (s.overlay.kind === "result") this.close(run.mode === "daily" && run.date === this.calendar.date ? "daily-recap" : "new-game");
				return;
			case "closed": {
				if (s.overlay.kind === "none" || s.overlay.closing?.id !== event.id) return;
				const outcome = s.overlay.closing.outcome;
				s.overlay = { kind: "none" };
				if (outcome === "start-gauntlet") {
					this.reset("gauntlet");
					this.options.view.announce(modeRules.gauntlet.description);
				} else if (outcome === "new-game" && run.mode) this.reset(run.mode);
				else if (outcome === "daily-recap") {
					if (run.mode === "daily") run.completed = false;
					s.rounds = emptyRounds();
					this.startCountdown();
				} else if (s.visible) {
					this.restore();
					this.prime();
				}
				this.focusAfterTransition = outcome === "daily-recap" ? "mode" : s.run.mode ? "play" : "progress";
				return;
			}
			case "hidden":
				s.visible = false;
				this.clock.pause();
				this.clearLoading();
				this.audio.suspend();
				return;
			case "visible":
				s.visible = true;
				if (run.mode === "daily") {
					if (this.calendar.reconcile() !== run.date && !finished(run)) {
						this.reset("daily");
						return;
					}
				}
				if (s.overlay.kind === "none") {
					this.restore();
					this.prime();
				}
				return;
			case "day":
				this.calendarDate = event.date;
				if (run.mode === "daily" && run.date !== event.date && !finished(run)) this.reset("daily");
				return;
			case "countdown": return;
			case "volume":
				this.audio.setVolume(event.value / 100);
				if (event.committed && Number.isInteger(event.value) && event.value >= 0 && event.value <= 100) {
					s.player.volume = event.value;
					if (!this.options.storage.write(s.player) && !this.volumeWarning) {
						this.volumeWarning = true;
						this.options.view.announce("VOLUME PREFERENCE COULD NOT BE SAVED IN THIS BROWSER.");
					}
				}
				return;
			case "share": {
				const result = resultFor(s);
				if (result?.mode !== "daily" || run.mode !== "daily") return;
				const epoch = s.epoch, date = run.date;
				this.options.copy(formatDailyShare(date, result)).then((copied) => this.dispatch({
					type: "shared",
					epoch,
					date,
					copied
				}), () => this.dispatch({
					type: "shared",
					epoch,
					date,
					copied: false
				}));
				return;
			}
			case "shared":
				if (event.epoch !== s.epoch || run.mode !== "daily" || run.date !== event.date || !run.completed) return;
				if (event.copied) this.options.view.showDailyShareCopied();
				this.options.view.announce(event.copied ? "RESULT COPIED TO CLIPBOARD." : "RESULT COULD NOT BE COPIED IN THIS BROWSER.");
				return;
			case "spotify": {
				const result = resultFor(s);
				const spotify = event.trackId !== void 0 ? s.overlay.kind === "discovery" && s.player.discoveries.includes(event.trackId) ? s.catalog.find((t) => t.dailyNumber === event.trackId)?.spotify : null : result?.mode === "classic" ? result.spotify : null;
				if (spotify) this.options.openSpotify(spotify);
				return;
			}
		}
	}
	reset(mode) {
		const s = this.state;
		const previous = s.run.mode === mode ? s.rounds.previous : null;
		this.clearLoading();
		this.audio.stop();
		this.calendar.stop();
		s.epoch++;
		s.rounds = emptyRounds(previous);
		if (mode === "daily") this.calendarDate = this.calendar.start();
		s.run = newRun(mode, this.calendarDate, s);
		this.validateRestore();
		this.clock.configure(mode === "blitz" ? 6e4 : mode === "gauntlet" ? 3e4 : snippet(s) * 1e3);
		if (mode === "daily" && this.dailyDone()) this.startCountdown();
		this.prime();
	}
	validateRestore() {
		const s = this.state;
		if (s.run.mode === "classic" && s.catalogPhase === "ready" && s.player.classic && !validClassic(s)) {
			s.player.classic = null;
			s.run.resumeChoice = false;
			this.clock.configure(1e3);
			this.save();
		}
	}
	prime() {
		const s = this.state;
		if (!this.unblocked() || s.catalogPhase !== "ready" || !s.run.mode || finished(s.run) || this.dailyDone() || s.rounds.current || s.rounds.exhausted) return;
		const round = chooseRound(s, ++this.nextRound, s.rounds.previous, this.random);
		if (!round) return;
		s.rounds.current = {
			round,
			phase: "prepared"
		};
		this.audio.loadPrimary(round);
	}
	prefetch() {
		const s = this.state;
		const current = s.rounds.current;
		if (!this.unblocked() || !current || current.phase === "retry" || s.rounds.next || s.rounds.nextFailures > 2 || s.run.mode !== "blitz" && s.run.mode !== "gauntlet" && s.run.mode !== "seek" || !this.audio.primaryStatus(current.round)?.ready) return;
		const round = chooseRound(s, ++this.nextRound, current.round.track.dailyNumber, this.random);
		if (!round) return;
		s.rounds.next = round;
		this.audio.loadPreload(round);
	}
	startRound(manual = false) {
		const s = this.state;
		if (!this.unblocked()) return;
		if (manual) {
			s.rounds.currentFailures = 0;
			s.rounds.nextFailures = 0;
			s.rounds.exhausted = false;
			if (s.rounds.current?.phase === "retry") if (s.run.mode !== "daily" && s.run.mode !== "classic") s.rounds.current = null;
			else {
				s.rounds.current.phase = "prepared";
				this.audio.loadPrimary(s.rounds.current.round);
			}
			else s.rounds.failed.clear();
		}
		let current = s.rounds.current;
		if (!current || current.phase === "heard") {
			if (s.rounds.next) {
				const round = s.rounds.next;
				s.rounds.next = null;
				s.rounds.current = {
					round,
					phase: "pending"
				};
				if (!this.audio.promotePreload(round)) {
					this.dispatch({
						type: "failed",
						failure: {
							stage: "primary-play",
							round
						}
					});
					return;
				}
			} else {
				const round = chooseRound(s, ++this.nextRound, s.rounds.previous, this.random);
				if (!round) {
					s.rounds.exhausted = true;
					this.options.view.announce(copy.trackError);
					return;
				}
				s.rounds.current = {
					round,
					phase: "prepared"
				};
				this.audio.loadPrimary(round);
			}
			current = s.rounds.current;
		}
		if (!current || current.phase === "retry") return;
		current.phase = "pending";
		if (!this.audio.playPrimary(current.round, false)) return;
		if (s.run.mode !== null) s.run.engaged = true;
		this.rememberPuzzle(current.round);
		this.clearLoading();
		this.notice(current.round);
		if (this.audio.primaryStatus(current.round)?.ready) this.prefetch();
	}
	play() {
		const s = this.state;
		if (s.run.mode === "daily") {
			if (this.calendar.reconcile() !== s.run.date) {
				this.reset("daily");
				return;
			}
		}
		if (!this.viewModel().playEnabled || !this.unblocked()) return;
		if (s.run.mode === "classic") s.run.resumeChoice = false;
		const current = s.rounds.current;
		if (!current || current.phase === "prepared" || current.phase === "retry" || s.rounds.exhausted) {
			this.startRound(current?.phase === "retry" || s.rounds.exhausted);
			return;
		}
		const requested = this.requested();
		this.clearLoading();
		if (timed(s.run.mode)) {
			if (requested) {
				this.clock.pause();
				this.audio.pause();
			} else if (this.audio.playPrimary(current.round, false)) this.notice(current.round);
		} else {
			const elapsed = this.clock.pause().elapsedMs;
			if (requested) this.audio.rewindPrimary(current.round);
			else if (this.audio.playPrimary(current.round, elapsed > 0)) this.notice(current.round);
			this.clock.restart(snippet(s) * 1e3);
			this.options.view.resetTimeline();
		}
		this.render();
		this.options.view.focusGuess();
	}
	rememberPuzzle(round) {
		const { run, player } = this.state;
		if (run.mode === "daily" && player.daily?.date !== run.date) {
			player.daily = {
				date: run.date,
				dailyNumber: round.track.dailyNumber,
				attempts: []
			};
			this.save();
		} else if (run.mode === "classic" && !player.classic) {
			player.classic = {
				dailyNumber: round.track.dailyNumber,
				clipStart: round.clipStart,
				attempts: []
			};
			this.save();
		}
	}
	answer(answer) {
		const s = this.state, run = s.run, current = s.rounds.current;
		if (!current || current.phase !== "heard" || finished(run) || !this.unblocked()) return;
		if (timed(run.mode) && this.clock.pause().remainingMs <= 0) {
			this.finish();
			return;
		}
		this.options.view.resetGuessInput();
		if (answer.outcome === "correct" && !s.player.discoveries.includes(current.round.track.dailyNumber)) s.player.discoveries.push(current.round.track.dailyNumber);
		if (run.mode === "daily" || run.mode === "classic") {
			const challenge = run.mode === "daily" ? s.player.daily : s.player.classic;
			if (!challenge) throw new Error("Heard puzzle has no authoritative challenge");
			const running = this.requested() && this.clock.snapshot().running;
			const resolution = puzzleAnswer(challenge.attempts, answer);
			if (run.mode === "daily" && s.player.daily) s.player.daily = {
				...s.player.daily,
				attempts: resolution.attempts
			};
			else if (s.player.classic) s.player.classic = {
				...s.player.classic,
				attempts: resolution.attempts
			};
			if (resolution.complete) {
				this.finish();
				return;
			}
			this.options.view.announce(answer.outcome === "wrong" ? "INCORRECT. TRY AGAIN." : "SKIPPED. MORE TIME ADDED.");
			const limit = resolution.snippetMs;
			if (running) this.clock.extendTo(limit);
			else {
				this.clearLoading();
				if (this.audio.playPrimary(current.round, true)) this.notice(current.round);
				this.options.view.resetTimeline();
				this.clock.restart(limit);
			}
			this.save();
			this.render();
			this.options.view.focusGuess();
			return;
		}
		if (run.mode !== "blitz" && run.mode !== "gauntlet") return;
		this.audio.pause();
		this.clearLoading();
		const survival = run.mode === "gauntlet" ? gauntletAnswer(run.attempts, answer, s.catalog.length) : null;
		run.attempts = survival?.attempts ?? blitzAnswer(run.attempts, answer);
		const won = survival?.complete ?? false;
		this.options.view.announce(won ? "CORRECT. GAUNTLET COMPLETE." : answer.outcome === "correct" ? "CORRECT." : answer.outcome === "wrong" ? "INCORRECT." : "SKIPPED.");
		if (won) {
			this.finish();
			return;
		}
		if (run.mode === "gauntlet") {
			const delta = survival.adjustmentMs;
			this.options.view.flashTimeChange(delta / 1e3);
			if (this.clock.adjust(delta).remainingMs <= 0) {
				this.finish();
				return;
			}
		}
		if (answer.outcome === "correct" || this.options.storage.dirty) this.save();
		this.startRound();
	}
	seekAction() {
		const s = this.state, run = s.run, current = s.rounds.current;
		if (run.mode !== "seek" || !this.viewModel().actionEnabled || !current) return;
		if (run.phase.kind === "revealed") if (run.answers.length === 5) this.finish();
		else {
			run.phase = {
				kind: "selecting",
				second: null
			};
			this.startRound();
		}
		else if (run.phase.kind === "selecting" && run.phase.second !== null) {
			this.clock.pause();
			this.audio.pause();
			this.clearLoading();
			run.answers = [seekAnswer(current.round, run.phase.second), ...run.answers];
			run.phase = { kind: "revealing" };
		}
	}
	finish() {
		if (finished(this.state.run)) return;
		const time = this.clock.pause();
		this.clearLoading();
		this.audio.stop();
		this.state.rounds.next = null;
		complete(this.state, time.elapsedMs);
		this.state.overlay = {
			kind: "result",
			closing: null
		};
		this.save();
	}
	failure(failure, restored) {
		const s = this.state;
		if (!this.unblocked() || finished(s.run)) return;
		if (failure.stage === "preload-load") {
			if (s.rounds.next?.id !== failure.round.id) return;
			s.rounds.next = null;
			s.rounds.failed.add(failure.round.track.dailyNumber);
			s.rounds.nextFailures++;
			if (s.rounds.nextFailures <= 2) this.prefetch();
			return;
		}
		const current = s.rounds.current;
		if (current?.round.id !== failure.round.id) return;
		const preserve = s.run.mode === "daily" || s.run.mode === "classic" && current.phase === "heard";
		const play = current.phase !== "prepared" || failure.stage === "primary-play";
		this.clock.pause();
		this.clearLoading();
		this.audio.releasePrimary();
		if (s.run.mode !== "daily") s.rounds.failed.add(failure.round.track.dailyNumber);
		s.rounds.currentFailures++;
		if (!preserve && !restored && s.rounds.currentFailures <= 2) {
			s.rounds.current = null;
			if (s.run.mode === "classic") {
				s.player.classic = null;
				s.run.resumeChoice = false;
				this.save();
			}
			if (s.run.mode === "seek") s.run.phase = {
				kind: "selecting",
				second: null
			};
			if (play) this.options.view.announce(copy.selectedTrackReplacing);
			const epoch = s.epoch;
			this.dispatch({
				type: "recover",
				epoch,
				play
			});
		} else {
			current.phase = "retry";
			this.options.view.announce(s.run.mode === "daily" || s.run.mode === "classic" ? copy.selectedTrackRetry : copy.trackError);
			this.render();
			this.options.view.focusPlay();
		}
	}
	close(outcome) {
		const overlay = this.state.overlay;
		if (overlay.kind === "none" || overlay.closing) return;
		const id = ++this.nextClose;
		overlay.closing = {
			id,
			outcome
		};
		if (overlay.kind === "result") this.options.view.beginResultClose(id, outcome === "daily-recap" ? "classic" : "play", outcome !== "daily-recap");
		else this.options.view.beginDiscoveryClose({ outcome: outcome === "start-gauntlet" ? "start-gauntlet" : "resume" }, id);
	}
	restore() {
		this.audio.restore((failure) => this.dispatch({
			type: "failed",
			failure,
			restored: true
		}));
	}
	dailyDone() {
		return this.state.run.mode === "daily" && this.state.player.daily?.date === this.state.run.date && puzzleDone(this.state.player.daily.attempts);
	}
	startCountdown() {
		this.calendar.startCountdown(() => this.dispatch({ type: "countdown" }));
	}
	unblocked() {
		return this.state.visible && this.state.overlay.kind === "none";
	}
	requested() {
		const current = this.state.rounds.current;
		return current ? this.audio.primaryStatus(current.round)?.playRequested ?? false : false;
	}
	clearLoading() {
		window.clearTimeout(this.loadingTimer);
		this.loadingTimer = 0;
		this.loading = false;
		this.loadingGeneration++;
	}
	notice(round) {
		const generation = this.loadingGeneration;
		this.loadingTimer = window.setTimeout(() => this.dispatch({
			type: "loading",
			id: round.id,
			generation
		}), 1e3);
	}
	save() {
		if (!this.options.storage.write(this.state.player) && this.state.overlay.kind !== "result") this.options.view.announce("PROGRESS COULD NOT BE SAVED IN THIS BROWSER.");
	}
	viewModel() {
		return present(this.state, {
			clock: this.clock.snapshot(),
			requested: this.requested(),
			loading: this.loading,
			unsaved: this.options.storage.dirty,
			date: this.calendarDate,
			countdown: this.calendar.countdownMs
		});
	}
	render() {
		this.options.view.render(this.viewModel(), String(this.state.epoch));
	}
};
function trackAssetNumber(dailyNumber) {
	return String(dailyNumber).padStart(2, "0");
}
var AttemptHistoryView = class {
	elements;
	durations;
	reducedMotion;
	scheduler;
	renderedSlots = [];
	sessionKey = "";
	renderGeneration = 0;
	nodeMotionGeneration = 0;
	fadeGenerations = /* @__PURE__ */ new WeakMap();
	collapseTimer = 0;
	collapseListener = null;
	pendingSnapshot = null;
	wiggles = /* @__PURE__ */ new Map();
	constructor(elements, durations, reducedMotion, scheduler = browserAnimationScheduler) {
		this.elements = elements;
		this.durations = durations;
		this.reducedMotion = reducedMotion;
		this.scheduler = scheduler;
	}
	render(slots, sessionKey) {
		const snapshot = {
			slots: [...slots],
			sessionKey
		};
		if (this.pendingSnapshot) {
			this.pendingSnapshot = snapshot;
			return;
		}
		if (this.sessionKey !== "" && sessionKey !== this.sessionKey && this.hasRenderedSlots()) {
			this.pendingSnapshot = snapshot;
			this.collapseSlots();
			return;
		}
		this.applySnapshot(snapshot, !this.hasRenderedSlots() && snapshot.slots.length > 0);
	}
	beginReset() {
		if (this.pendingSnapshot || !this.hasRenderedSlots()) return;
		this.pendingSnapshot = {
			slots: [],
			sessionKey: this.sessionKey
		};
		this.collapseSlots();
	}
	applySnapshot(snapshot, reveal = false) {
		this.sessionKey = snapshot.sessionKey;
		this.renderSlots(snapshot.slots, snapshot.sessionKey);
		if (reveal) this.revealAttempts();
	}
	renderSlots(entries, sessionKey) {
		const rendered = entries.map((entry) => ({
			key: `${sessionKey}:${entry.id}`,
			text: entry.text,
			tone: entry.tone,
			gauntletMilestone: entry.gauntletMilestone === true
		}));
		if (rendered.length === this.renderedSlots.length && rendered.every((entry, index) => {
			const previous = this.renderedSlots[index];
			return previous?.key === entry.key && previous.text === entry.text && previous.tone === entry.tone && previous.gauntletMilestone === entry.gauntletMilestone;
		})) return;
		const previousSlots = this.renderedSlots;
		this.renderedSlots = rendered;
		this.renderGeneration += 1;
		this.cancelCollapse();
		const existing = new Map([...this.elements.list.children].map((child) => {
			const element = child;
			return [element.dataset.slotKey ?? "", element];
		}));
		const previousEntries = new Map(previousSlots.map((entry) => [entry.key, entry]));
		const fadeNodes = [];
		const wiggleNodes = [];
		const nodes = rendered.map((entry) => {
			let element = existing.get(entry.key);
			const isNew = !element;
			if (!element) {
				element = document.createElement("div");
				element.className = "slot fade";
				element.dataset.slotKey = entry.key;
			}
			existing.delete(entry.key);
			const previous = previousEntries.get(entry.key);
			const previousTone = previous?.tone ?? "";
			const previousText = previous?.text ?? "";
			const wasMilestone = previous?.gauntletMilestone ?? false;
			const changedHead = (isNew || previousText !== entry.text || previousTone !== entry.tone || wasMilestone !== entry.gauntletMilestone) && previousSlots[0]?.key === entry.key;
			this.applyTone(element, previousTone, entry.tone);
			element.textContent = entry.text;
			this.applyGauntletMilestone(element, entry.gauntletMilestone, entry.text);
			if (/^(wrong|skip)$/.test(entry.tone) && (isNew || previousTone !== entry.tone)) wiggleNodes.push(element);
			if (isNew || changedHead) fadeNodes.push(element);
			return element;
		});
		for (const removed of existing.values()) {
			this.fadeGenerations.delete(removed);
			this.cancelWiggle(removed);
		}
		this.elements.list.replaceChildren(...nodes);
		for (const element of fadeNodes) this.fadeIn(element);
		for (const element of wiggleNodes) this.startWiggle(element);
	}
	hasRenderedSlots() {
		return this.elements.list.children.length > 0;
	}
	collapseSlots() {
		this.startCollapse(this.elements.container, [...this.elements.list.children], this.durations.collapse, () => {
			const pending = this.pendingSnapshot;
			this.pendingSnapshot = null;
			this.clearRenderedSlots();
			if (pending) this.applySnapshot(pending, pending.slots.length > 0);
		});
	}
	revealAttempts() {
		const container = this.elements.container;
		const duration = this.durations.collapse;
		this.cancelCollapse();
		if (this.reducedMotion.matches || duration <= 0) {
			container.style.height = "";
			return;
		}
		const targetHeight = container.offsetHeight;
		container.style.height = "0px";
		container.offsetHeight;
		container.style.height = `${targetHeight}px`;
		const generation = ++this.renderGeneration;
		this.waitForHeightTransition(container, duration, generation, () => {
			container.style.height = "";
		});
	}
	startCollapse(container, fading, duration, onFinished) {
		this.cancelCollapse();
		const generation = ++this.renderGeneration;
		if (this.reducedMotion.matches || duration <= 0) {
			onFinished();
			return;
		}
		const fadeStarts = fading.map((element) => {
			const styles = getComputedStyle(element);
			this.fadeGenerations.delete(element);
			return {
				element,
				opacity: styles.opacity,
				translate: styles.translate
			};
		});
		container.style.height = `${container.offsetHeight}px`;
		for (const { element, opacity, translate } of fadeStarts) {
			element.style.transition = "none";
			element.style.opacity = opacity;
			element.style.translate = translate;
			element.classList.remove("fade");
		}
		container.offsetHeight;
		for (const { element } of fadeStarts) {
			element.style.transition = "";
			element.classList.add("fade");
			element.style.removeProperty("opacity");
			element.style.removeProperty("translate");
		}
		container.style.height = "0px";
		this.waitForHeightTransition(container, duration, generation, onFinished);
	}
	waitForHeightTransition(container, duration, generation, onFinished) {
		const finish = () => {
			if (generation !== this.renderGeneration) return;
			this.cancelCollapse(false);
			onFinished();
		};
		this.collapseListener = (event) => {
			const transition = event;
			if (event.target === container && (!transition.propertyName || transition.propertyName === "height")) finish();
		};
		container.addEventListener("transitionend", this.collapseListener);
		this.collapseTimer = this.scheduler.setTimer(finish, duration);
	}
	cancelCollapse(resetHeight = true) {
		if (this.collapseTimer) this.scheduler.clearTimer(this.collapseTimer);
		this.collapseTimer = 0;
		if (this.collapseListener) this.elements.container.removeEventListener("transitionend", this.collapseListener);
		if (resetHeight && this.collapseListener) this.elements.container.style.height = "";
		this.collapseListener = null;
	}
	clearRenderedSlots() {
		this.renderedSlots = [];
		this.renderGeneration += 1;
		for (const child of this.elements.list.children) {
			const element = child;
			this.fadeGenerations.delete(element);
			this.cancelWiggle(element);
		}
		this.elements.container.style.height = "";
		this.elements.list.replaceChildren();
	}
	applyTone(element, previous, next) {
		if (previous === next) return;
		element.classList.remove(...toneClasses(previous));
		element.classList.add(...toneClasses(next));
	}
	applyGauntletMilestone(element, gauntletMilestone, text) {
		element.classList.toggle("gauntlet-milestone", gauntletMilestone);
		if (gauntletMilestone) element.setAttribute("aria-label", `${text}. Counts toward Gauntlet completion.`);
		else element.removeAttribute("aria-label");
	}
	fadeIn(element) {
		if (this.reducedMotion.matches) {
			element.style.transition = "";
			element.classList.remove("fade");
			return;
		}
		element.style.transition = "none";
		element.classList.add("fade");
		element.offsetWidth;
		element.style.transition = "";
		element.offsetWidth;
		const generation = ++this.nodeMotionGeneration;
		this.fadeGenerations.set(element, generation);
		this.scheduler.requestFrame(() => {
			if (this.fadeGenerations.get(element) !== generation || !element.isConnected) return;
			this.fadeGenerations.delete(element);
			element.classList.remove("fade");
		});
	}
	startWiggle(element) {
		this.cancelWiggle(element);
		if (this.reducedMotion.matches || this.durations.wiggle <= 0) return;
		element.classList.remove("wiggle");
		element.offsetWidth;
		element.classList.add("wiggle");
		let timer = 0;
		const finish = () => {
			const active = this.wiggles.get(element);
			if (!active) return;
			active.cancel();
		};
		const listener = (event) => {
			const animation = event;
			if (event.target === element && (!animation.animationName || animation.animationName === "wiggle")) finish();
		};
		const cancel = () => {
			element.removeEventListener("animationend", listener);
			if (timer) this.scheduler.clearTimer(timer);
			element.classList.remove("wiggle");
			this.wiggles.delete(element);
		};
		this.wiggles.set(element, { cancel });
		element.addEventListener("animationend", listener);
		timer = this.scheduler.setTimer(finish, this.durations.wiggle);
	}
	cancelWiggle(element) {
		this.wiggles.get(element)?.cancel();
	}
};
function toneClasses(tone) {
	if (tone === "correct" || tone === "wrong" || tone === "skip") return [tone];
	if (tone === "final-prompt" || tone === "technical") return ["blink"];
	return [];
}
var tokenAliases = {
	featuring: "feat",
	feat: "feat",
	ft: "feat",
	versus: "vs",
	vs: "vs",
	and: "and"
};
function normalizeTrackSearch(value) {
	return value.normalize("NFKD").replace(/\p{M}/gu, "").toLocaleLowerCase().replace(/[’'‘`]/gu, "").replace(/&/gu, " and ").replace(/[^\p{L}\p{N}]+/gu, " ").trim().split(/\s+/u).filter(Boolean).map((word) => tokenAliases[word] ?? word).join(" ");
}
function createTrackSearchIndex(tracks) {
	return tracks.map((track, catalogIndex) => {
		const normalized = normalizeTrackSearch(track.title);
		return {
			track,
			normalized,
			tokens: normalized.split(" "),
			catalogIndex
		};
	});
}
function searchTrackIndex(index, input, unavailable, limit = 8) {
	const query = normalizeTrackSearch(input);
	if (!query) return [];
	const queryTokens = query.split(" ");
	return index.filter((entry) => !unavailable.has(entry.track.dailyNumber)).map((entry) => ({
		entry,
		rank: matchRank(entry, query, queryTokens)
	})).filter((candidate) => candidate.rank !== null).sort((left, right) => left.rank[0] - right.rank[0] || left.rank[1] - right.rank[1] || left.entry.catalogIndex - right.entry.catalogIndex).slice(0, limit).map(({ entry }) => entry.track);
}
function matchRank(entry, query, queryTokens) {
	if (entry.normalized === query) return [0, 0];
	if (entry.normalized.startsWith(query)) return [1, 0];
	const phrasePosition = entry.normalized.indexOf(query);
	if (phrasePosition >= 0) return [2, phrasePosition];
	const prefixPositions = tokenPositions(entry.tokens, queryTokens, (titleToken, queryToken) => titleToken.startsWith(queryToken));
	if (prefixPositions) return [3, prefixPositions];
	const partialPositions = tokenPositions(entry.tokens, queryTokens, (titleToken, queryToken) => titleToken.includes(queryToken));
	return partialPositions === null ? null : [4, partialPositions];
}
function tokenPositions(titleTokens, queryTokens, matches) {
	let positionTotal = 0;
	for (const queryToken of queryTokens) {
		const position = titleTokens.findIndex((titleToken) => matches(titleToken, queryToken));
		if (position < 0) return null;
		positionTotal += position;
	}
	return positionTotal;
}
var maxSuggestions = 5;
var Autocomplete = class {
	input;
	list;
	onGuess;
	onPlaybackShortcut;
	tracks = [];
	searchIndex = [];
	releaseDate = null;
	unavailable = /* @__PURE__ */ new Set();
	suggestions = [];
	selectedIndex = -1;
	constructor(input, list, onGuess, onPlaybackShortcut) {
		this.input = input;
		this.list = list;
		this.onGuess = onGuess;
		this.onPlaybackShortcut = onPlaybackShortcut;
		input.addEventListener("input", () => {
			if (!this.input.disabled) this.update();
		});
		input.addEventListener("keydown", (event) => this.handleKeydown(event));
		list.addEventListener("pointerover", (event) => {
			if (this.input.disabled) return;
			const option = event.target instanceof Element ? event.target.closest("[role=option]") : null;
			if (!option) return;
			const index = [...this.list.children].indexOf(option);
			if (index >= 0) this.select(index);
		});
		list.addEventListener("click", (event) => {
			if (this.input.disabled) return;
			const option = event.target instanceof Element ? event.target.closest("[role=option]") : null;
			if (!option) return;
			const track = this.suggestions[[...this.list.children].indexOf(option)];
			if (track) this.onGuess(track.dailyNumber);
		});
	}
	setDependencies(tracks, unavailable, releaseDate = null) {
		const unavailableChanged = unavailable.size !== this.unavailable.size || [...unavailable].some((id) => !this.unavailable.has(id));
		const catalogChanged = tracks !== this.tracks || releaseDate !== this.releaseDate;
		if (!catalogChanged && !unavailableChanged) return;
		const selectedId = this.suggestions[this.selectedIndex]?.dailyNumber ?? null;
		if (catalogChanged) {
			this.tracks = tracks;
			this.releaseDate = releaseDate;
			this.searchIndex = createTrackSearchIndex(releaseDate === null ? tracks : tracks.filter((track) => isReleasedBy(track, releaseDate)));
		}
		this.unavailable = new Set(unavailable);
		if (this.input.value.trim() && !this.input.disabled) this.update(selectedId);
	}
	setSuspended(suspended) {
		if (suspended === this.input.disabled) return;
		this.input.disabled = suspended;
		this.suggestions = [];
		this.selectedIndex = -1;
		this.render();
		if (!suspended && this.input.value.trim()) this.update();
	}
	reset() {
		this.input.value = "";
		this.suggestions = [];
		this.selectedIndex = -1;
		this.render();
	}
	update(selectedId = null) {
		this.suggestions = searchTrackIndex(this.searchIndex, this.input.value, this.unavailable, maxSuggestions);
		const preserved = selectedId === null ? -1 : this.suggestions.findIndex((track) => track.dailyNumber === selectedId);
		this.selectedIndex = preserved >= 0 ? preserved : this.suggestions.length ? 0 : -1;
		this.render();
	}
	select(index, reveal = false) {
		if (!this.suggestions.length) return;
		this.selectedIndex = (index % this.suggestions.length + this.suggestions.length) % this.suggestions.length;
		this.renderSelection(reveal);
	}
	handleKeydown(event) {
		if (event.key === "Escape") {
			this.reset();
			return;
		}
		if (this.input.disabled) {
			if (event.key === "Enter") {
				event.preventDefault();
				if (!this.input.value.trim()) this.onPlaybackShortcut();
			}
			return;
		}
		if (event.key === "ArrowDown" || event.key === "ArrowUp") {
			if (!this.suggestions.length) return;
			event.preventDefault();
			this.select(this.selectedIndex + (event.key === "ArrowDown" ? 1 : -1), true);
			return;
		}
		if (event.key !== "Enter") return;
		event.preventDefault();
		if (!this.input.value.trim()) {
			this.onPlaybackShortcut();
			return;
		}
		const track = this.suggestions[this.selectedIndex];
		if (track) this.onGuess(track.dailyNumber);
	}
	render() {
		const options = this.suggestions.map((track, index) => {
			const option = document.createElement("button");
			option.type = "button";
			option.tabIndex = -1;
			option.id = `corzaguessr-option-${index}`;
			option.textContent = track.title;
			option.setAttribute("role", "option");
			const active = index === this.selectedIndex;
			option.setAttribute("aria-selected", String(active));
			if (active) option.className = "active";
			return option;
		});
		this.list.replaceChildren(...options);
		this.list.scrollTop = 0;
		const visible = options.length > 0;
		this.list.style.display = visible ? "block" : "none";
		this.input.setAttribute("aria-expanded", String(visible));
		this.renderSelection();
	}
	renderSelection(reveal = false) {
		[...this.list.children].forEach((element, index) => {
			const option = element;
			const active = index === this.selectedIndex;
			option.classList.toggle("active", active);
			option.setAttribute("aria-selected", String(active));
		});
		if (this.suggestions.length && this.selectedIndex >= 0) {
			this.input.setAttribute("aria-activedescendant", `corzaguessr-option-${this.selectedIndex}`);
			if (reveal) {
				const option = this.list.children[this.selectedIndex];
				if (option) {
					const top = option.offsetTop;
					const bottom = top + option.offsetHeight;
					if (top < this.list.scrollTop) this.list.scrollTop = top;
					else if (bottom > this.list.scrollTop + this.list.clientHeight) this.list.scrollTop = bottom - this.list.clientHeight;
				}
			}
		} else this.input.removeAttribute("aria-activedescendant");
	}
};
function formatReleaseDate(value) {
	return value === null ? "TBA" : formatOrdinalDate(value);
}
var DiscoveryListView = class {
	count;
	items;
	coverUrl;
	expandedTrackId = null;
	openSpotify = null;
	startGauntlet = null;
	tracks = null;
	discoveriesSignature = "";
	constructor(count, items, coverUrl) {
		this.count = count;
		this.items = items;
		this.coverUrl = coverUrl;
	}
	bind(openSpotify, startGauntlet) {
		this.openSpotify = openSpotify;
		this.startGauntlet = startGauntlet;
	}
	collapseAll() {
		if (this.expandedTrackId === null) return;
		const expandedTrackId = this.expandedTrackId;
		this.expandedTrackId = null;
		this.updateItem(expandedTrackId, false);
	}
	render(tracks, discoveries) {
		const signature = [...discoveries].sort((a, b) => a - b).join(",");
		if (tracks === this.tracks && signature === this.discoveriesSignature) return;
		this.tracks = tracks;
		this.discoveriesSignature = signature;
		const ordered = [...tracks].sort((a, b) => b.dailyNumber - a.dailyNumber);
		const { discovered, total, percentage, complete } = summarizeDiscovery(tracks, discoveries);
		this.count.replaceChildren(document.createTextNode(`${discovered} / ${total} (${percentage}%)${complete ? " " : ""}`));
		if (complete) {
			const gauntlet = document.createElement("button");
			gauntlet.type = "button";
			gauntlet.className = "discovery-gauntlet";
			gauntlet.textContent = "✦";
			gauntlet.setAttribute("aria-label", "SECRET MODE");
			gauntlet.addEventListener("pointerdown", (event) => event.preventDefault());
			gauntlet.addEventListener("click", () => this.startGauntlet?.());
			this.count.append(gauntlet);
		}
		this.count.setAttribute("aria-label", `${discovered} of ${total}, ${percentage} percent${complete ? ", Discovery complete" : ""}`);
		if (this.expandedTrackId !== null && !discoveries.has(this.expandedTrackId)) this.expandedTrackId = null;
		this.items.replaceChildren(...ordered.map((track) => discoveries.has(track.dailyNumber) ? this.createDiscoveredItem(track) : this.createUndiscoveredItem(track)));
	}
	createDiscoveredItem(track) {
		const item = document.createElement("div");
		item.className = "discovery-item discovery-item-known";
		item.dataset.trackId = String(track.dailyNumber);
		item.setAttribute("role", "listitem");
		const coverUrl = this.coverUrl(track.dailyNumber);
		item.style.setProperty("--discovery-artwork", `url(${JSON.stringify(coverUrl)})`);
		const detailsId = `corzaguessr-discovery-track-${track.dailyNumber}`;
		const toggle = document.createElement("button");
		toggle.type = "button";
		toggle.className = "discovery-item-toggle";
		toggle.setAttribute("aria-controls", detailsId);
		const compact = document.createElement("span");
		compact.className = "discovery-item-compact";
		compact.textContent = track.title;
		const details = document.createElement("span");
		details.id = detailsId;
		details.className = "discovery-track-details";
		const cover = document.createElement("span");
		cover.className = "discovery-cover";
		const image = document.createElement("img");
		image.src = coverUrl;
		image.alt = "";
		image.width = 200;
		image.height = 200;
		image.loading = "lazy";
		image.decoding = "async";
		image.addEventListener("error", () => {
			image.hidden = true;
			cover.classList.add("missing");
		}, { once: true });
		cover.append(image);
		const [artist, title] = splitTrackTitle(track.title);
		const metadata = document.createElement("span");
		metadata.className = "discovery-track-metadata";
		const artistElement = document.createElement("span");
		artistElement.className = "discovery-artist";
		artistElement.textContent = artist;
		const titleElement = document.createElement("strong");
		titleElement.className = "discovery-song-title";
		titleElement.textContent = title;
		const date = document.createElement("small");
		date.className = "discovery-release-date";
		date.textContent = `RELEASE DATE: ${formatReleaseDate(track.releaseDate)}`;
		metadata.append(artistElement, titleElement, date);
		details.append(cover, metadata);
		toggle.append(compact, details);
		toggle.addEventListener("click", () => this.toggle(track.dailyNumber));
		item.append(toggle);
		if (track.spotify) {
			const spotify = document.createElement("button");
			spotify.type = "button";
			spotify.className = "button discovery-track-spotify";
			spotify.textContent = "SPOTIFY";
			spotify.setAttribute("aria-label", `OPEN ${track.title} ON SPOTIFY`);
			spotify.addEventListener("click", () => this.openSpotify?.(track.dailyNumber));
			item.append(spotify);
		}
		this.applyExpandedState(item, track.dailyNumber === this.expandedTrackId);
		return item;
	}
	createUndiscoveredItem(track) {
		const item = document.createElement("div");
		item.className = "discovery-item";
		item.setAttribute("role", "listitem");
		if (track.isNew) {
			item.classList.add("discovery-item-new");
			const badge = document.createElement("span");
			badge.className = "discovery-new";
			badge.textContent = "NEW";
			badge.setAttribute("aria-hidden", "true");
			const hidden = document.createElement("span");
			hidden.className = "discovery-track";
			hidden.textContent = "?".repeat(20);
			item.append(badge, hidden, badge.cloneNode(true));
			item.setAttribute("aria-label", "NEW UNDISCOVERED TRACK");
		} else {
			item.textContent = "?".repeat(20);
			item.setAttribute("aria-hidden", "true");
		}
		return item;
	}
	toggle(trackId) {
		const previousId = this.expandedTrackId;
		this.expandedTrackId = previousId === trackId ? null : trackId;
		if (previousId !== null) this.updateItem(previousId, false);
		const opening = this.expandedTrackId === trackId;
		this.updateItem(trackId, opening);
		if (opening) requestAnimationFrame(() => this.revealExpandedItem(trackId));
	}
	updateItem(trackId, expanded) {
		const item = this.items.querySelector(`.discovery-item[data-track-id="${trackId}"]`);
		if (item) this.applyExpandedState(item, expanded);
	}
	applyExpandedState(item, expanded) {
		item.classList.toggle("expanded", expanded);
		const toggle = item.querySelector(".discovery-item-toggle");
		const details = item.querySelector(".discovery-track-details");
		const spotify = item.querySelector(".discovery-track-spotify");
		toggle?.setAttribute("aria-expanded", String(expanded));
		if (toggle) {
			const title = item.dataset.trackId ? this.tracks?.find((track) => String(track.dailyNumber) === item.dataset.trackId)?.title : null;
			toggle.setAttribute("aria-label", `${expanded ? "HIDE" : "SHOW"} DETAILS FOR ${title ?? "TRACK"}`);
		}
		if (details) details.setAttribute("aria-hidden", String(!expanded));
		if (spotify) spotify.disabled = !expanded;
	}
	revealExpandedItem(trackId) {
		if (this.expandedTrackId !== trackId) return;
		const item = this.items.querySelector(`.discovery-item[data-track-id="${trackId}"]`);
		if (!item) return;
		const heightTransition = typeof item.getAnimations === "function" ? item.getAnimations().find((animation) => "transitionProperty" in animation && animation.transitionProperty === "height") : void 0;
		if (heightTransition) {
			const observer = new ResizeObserver(() => {
				this.scrollExpandedItemIntoView(trackId, item);
			});
			observer.observe(item);
			const finish = () => {
				observer.disconnect();
				this.scrollExpandedItemIntoView(trackId, item);
			};
			heightTransition.finished.then(finish, finish);
			return;
		}
		this.scrollExpandedItemIntoView(trackId, item);
	}
	scrollExpandedItemIntoView(trackId, item) {
		if (this.expandedTrackId !== trackId || !item.classList.contains("expanded")) return;
		const itemBounds = item.getBoundingClientRect();
		const listBounds = this.items.getBoundingClientRect();
		if (itemBounds.top < listBounds.top) this.items.scrollTop += itemBounds.top - listBounds.top;
		else if (itemBounds.bottom > listBounds.bottom) this.items.scrollTop += itemBounds.bottom - listBounds.bottom;
	}
};
function splitTrackTitle(value) {
	const separator = value.indexOf(" - ");
	return separator < 0 ? ["", value] : [value.slice(0, separator), value.slice(separator + 3)];
}
function nextPrimaryFocus(state, key) {
	const modeIndex = state.current ? regularModes.findIndex((mode) => mode === state.current) : -1;
	if (modeIndex >= 0) {
		if (key === "ArrowUp") return available(state, "discovery");
		if (key === "ArrowDown") return available(state, "play");
		return modeInDirection(state, modeIndex, key === "ArrowLeft" ? -1 : 1);
	}
	const recommended = recommendedMode(state);
	if (state.current === "discovery") {
		if (key === "ArrowDown") return recommended;
		if (key === "ArrowLeft") return regularModes.find((mode) => state.enabled.has(mode)) ?? null;
		if (key === "ArrowRight") return [...regularModes].reverse().find((mode) => state.enabled.has(mode)) ?? null;
		return null;
	}
	if (state.current === "play") return key === "ArrowUp" ? recommended : null;
	return state.selectedMode && state.enabled.has("play") ? "play" : recommended;
}
function recommendedMode(state) {
	if (state.completedDaily && state.enabled.has("classic")) return "classic";
	if (!state.selectedMode && state.enabled.has("daily")) return "daily";
	const selectedIndex = state.selectedMode ? regularModes.findIndex((mode) => mode === state.selectedMode) : -1;
	if (selectedIndex < 0) return regularModes.find((mode) => state.enabled.has(mode)) ?? null;
	for (let distance = 1; distance < regularModes.length; distance += 1) {
		const right = regularModes[selectedIndex + distance];
		if (right && state.enabled.has(right)) return right;
		const left = regularModes[selectedIndex - distance];
		if (left && state.enabled.has(left)) return left;
	}
	return regularModes.find((mode) => state.enabled.has(mode)) ?? null;
}
function modeInDirection(state, start, step) {
	for (let distance = 1; distance < regularModes.length; distance += 1) {
		const mode = regularModes[(start + step * distance + regularModes.length) % regularModes.length];
		if (mode && state.enabled.has(mode)) return mode;
	}
	return null;
}
function available(state, target) {
	return state.enabled.has(target) ? target : null;
}
var ModalController = class {
	root;
	elements;
	duration;
	reducedMotion;
	announce;
	scheduler;
	kind = null;
	closing = false;
	returnFocus = null;
	closeTimer = 0;
	openFrame = 0;
	transitionGeneration = 0;
	closeListener = null;
	lockedScroll = null;
	constructor(root, elements, duration, reducedMotion, announce, scheduler = browserAnimationScheduler) {
		this.root = root;
		this.elements = elements;
		this.duration = duration;
		this.reducedMotion = reducedMotion;
		this.announce = announce;
		this.scheduler = scheduler;
	}
	get resultLayoutActive() {
		return this.kind === "result";
	}
	get resultClosing() {
		return this.kind === "result" && this.closing;
	}
	openResult(announcement = "RESULT") {
		if (this.openModal("result")) this.announce(announcement || "RESULT");
	}
	openDiscovery() {
		this.openModal("discovery");
	}
	closeResult(fallbackFocus, onClosed = () => {}, onClosing = () => {}) {
		return this.closeModal("result", fallbackFocus, onClosed, null, onClosing);
	}
	closeDiscovery(fallbackFocus, onClosed, focusOverride = null) {
		return this.closeModal("discovery", fallbackFocus, onClosed, focusOverride);
	}
	openModal(kind) {
		if (this.kind) return false;
		const parts = this.parts(kind);
		const generation = this.beginOpen();
		this.kind = kind;
		this.closing = false;
		this.captureReturnFocus();
		this.lockScroll();
		parts.classOwner.classList.add(parts.openClass);
		parts.modal.setAttribute("aria-hidden", "false");
		if (kind === "discovery") this.elements.discoveryButton.setAttribute("aria-expanded", "true");
		const finishOpen = () => {
			this.openFrame = 0;
			if (!this.transitionMatches(kind, generation)) return;
			parts.classOwner.classList.add(parts.visibleClass);
			parts.shell.style.height = `${parts.panel.offsetHeight}px`;
			if (this.reducedMotion.matches && kind === "discovery") {
				parts.shell.offsetHeight;
				this.elements.discoveryClose.style.visibility = "visible";
			}
			parts.focusTarget.focus({ preventScroll: true });
		};
		if (this.reducedMotion.matches) {
			parts.shell.style.transition = "none";
			finishOpen();
		} else {
			parts.shell.style.height = "0px";
			parts.shell.offsetHeight;
			this.openFrame = this.scheduler.requestFrame(finishOpen);
		}
		return true;
	}
	closeModal(kind, fallbackFocus, onClosed, focusOverride = null, onClosing = () => {}) {
		if (this.closing || this.kind !== kind) return false;
		const parts = this.parts(kind);
		this.closing = true;
		onClosing();
		const generation = ++this.transitionGeneration;
		this.scheduler.cancelFrame(this.openFrame);
		this.openFrame = 0;
		this.cancelCloseWait();
		parts.classOwner.classList.remove(parts.visibleClass);
		parts.shell.style.height = `${parts.shell.offsetHeight}px`;
		parts.shell.offsetHeight;
		parts.shell.style.height = "0px";
		if (kind === "discovery") this.elements.discoveryButton.setAttribute("aria-expanded", "false");
		const finish = () => {
			if (this.kind !== kind || this.transitionGeneration !== generation) return;
			this.cancelCloseWait();
			parts.classOwner.classList.remove(parts.openClass, parts.visibleClass);
			parts.modal.setAttribute("aria-hidden", "true");
			parts.shell.style.height = "";
			parts.shell.style.transition = "";
			if (kind === "discovery") this.elements.discoveryClose.style.visibility = "";
			this.kind = null;
			this.closing = false;
			this.unlockScroll();
			onClosed();
			const preferred = this.returnFocus;
			this.returnFocus = null;
			const override = focusOverride?.();
			const target = override && this.canFocus(override) ? override : preferred && this.canFocus(preferred) ? preferred : fallbackFocus;
			if (this.canFocus(target)) target.focus({ preventScroll: true });
		};
		if (this.reducedMotion.matches) {
			finish();
			return true;
		}
		const transitionTarget = parts.shell;
		this.closeListener = (event) => {
			const transition = event;
			if (event.target === transitionTarget && (!transition.propertyName || transition.propertyName === "height")) finish();
		};
		transitionTarget.addEventListener("transitionend", this.closeListener);
		this.closeTimer = this.scheduler.setTimer(finish, this.duration);
		return true;
	}
	trapFocus(event) {
		if (event.key !== "Tab" || !this.kind) return;
		const container = this.kind === "result" ? this.elements.result : this.elements.discoveryPanel;
		const focusable = [...container.querySelectorAll("button:not([disabled]), input:not([disabled])")].filter((element) => element.tabIndex >= 0 && !element.hidden && element.offsetParent !== null);
		if (!focusable.length) return;
		const first = focusable[0];
		const last = focusable.at(-1);
		if (!container.contains(document.activeElement)) {
			event.preventDefault();
			(event.shiftKey ? last : first).focus();
		} else if (event.shiftKey && document.activeElement === first) {
			event.preventDefault();
			last.focus();
		} else if (!event.shiftKey && document.activeElement === last) {
			event.preventDefault();
			first.focus();
		}
	}
	captureReturnFocus() {
		this.returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
	}
	lockScroll() {
		if (this.lockedScroll) return;
		const html = document.documentElement;
		const body = document.body;
		const scrollbarWidth = Math.max(0, window.innerWidth - html.clientWidth);
		this.lockedScroll = {
			htmlCssText: html.style.cssText,
			bodyCssText: body.style.cssText,
			scrollX: window.scrollX,
			scrollY: window.scrollY
		};
		if (scrollbarWidth > 0) {
			const currentPadding = Number.parseFloat(getComputedStyle(body).paddingInlineEnd) || 0;
			body.style.setProperty("padding-inline-end", `${currentPadding + scrollbarWidth}px`);
		}
		html.style.setProperty("overflow", "hidden", "important");
		body.style.setProperty("overflow", "hidden", "important");
	}
	unlockScroll() {
		if (!this.lockedScroll) return;
		const snapshot = this.lockedScroll;
		document.documentElement.style.cssText = snapshot.htmlCssText;
		document.body.style.cssText = snapshot.bodyCssText;
		this.lockedScroll = null;
		if (window.scrollX !== snapshot.scrollX || window.scrollY !== snapshot.scrollY) window.scrollTo(snapshot.scrollX, snapshot.scrollY);
	}
	canFocus(element) {
		return element.isConnected && element.tabIndex >= 0 && !element.matches(":disabled") && !element.hidden && !element.closest("[inert]");
	}
	beginOpen() {
		this.cancelCloseWait();
		this.scheduler.cancelFrame(this.openFrame);
		this.openFrame = 0;
		return ++this.transitionGeneration;
	}
	transitionMatches(kind, generation) {
		return this.kind === kind && !this.closing && this.transitionGeneration === generation;
	}
	cancelCloseWait() {
		if (this.closeTimer) this.scheduler.clearTimer(this.closeTimer);
		this.closeTimer = 0;
		if (this.closeListener && this.kind) this.parts(this.kind).shell.removeEventListener("transitionend", this.closeListener);
		this.closeListener = null;
	}
	parts(kind) {
		return kind === "result" ? {
			classOwner: this.elements.card,
			openClass: "result-open",
			visibleClass: "result-visible",
			modal: this.elements.result,
			shell: this.elements.resultShell,
			panel: this.elements.resultPanel,
			focusTarget: this.elements.resultAction
		} : {
			classOwner: this.root,
			openClass: "discovery-open",
			visibleClass: "discovery-visible",
			modal: this.elements.discoveryModal,
			shell: this.elements.discoveryShell,
			panel: this.elements.discoveryPanel,
			focusTarget: this.elements.discoveryClose
		};
	}
};
var emptyRecordValue = "---";
var emptyRecordDetail = "NO RECORD";
var ProgressSummaryView = class {
	container;
	signature = "";
	constructor(container) {
		this.container = container;
	}
	render(bests, daily, dailyDate) {
		const summaryRows = rows(bests, daily, dailyDate);
		const signature = JSON.stringify(summaryRows);
		if (signature === this.signature) return;
		this.signature = signature;
		this.container.replaceChildren(...summaryRows.map((row) => {
			const item = document.createElement("div");
			item.className = "progress-best";
			const mode = document.createElement("span");
			mode.className = "progress-best-mode";
			mode.textContent = row.mode;
			const value = document.createElement("strong");
			value.textContent = row.value;
			const detail = document.createElement("small");
			detail.textContent = row.detail;
			item.append(mode, value, detail);
			return item;
		}));
	}
};
function rows(bests, daily, dailyDate) {
	const classicAverage = bests.classic.best ? bests.classic.bestSnippetTotal / bests.classic.best : 0;
	const dailyComplete = dailyCompleted(daily, dailyDate);
	const standard = [
		{
			mode: "DAILY",
			value: dailyComplete ? dailyWon(daily, dailyDate) ? `${dailyAttempt(daily) + 1}/${puzzleAttemptCount}` : "FAILED" : emptyRecordValue,
			detail: dailyComplete ? formatOrdinalDate(dailyDate) : emptyRecordDetail
		},
		{
			mode: "CLASSIC",
			value: bests.classic.best ? `${bests.classic.best}-GAME STREAK` : emptyRecordValue,
			detail: bests.classic.best ? `AVERAGE ${formatDecimal(classicAverage)}s` : emptyRecordDetail
		},
		{
			mode: "BLITZ",
			value: bests.blitz.score ? `${bests.blitz.score} CORRECT` : emptyRecordValue,
			detail: bests.blitz.score ? `${bests.blitz.accuracy ?? 0}% SUCCESS RATE` : emptyRecordDetail
		},
		{
			mode: "SEEK",
			value: bests.seek.score ? `${bests.seek.score} POINTS` : emptyRecordValue,
			detail: bests.seek.score ? "BEST SCORE" : emptyRecordDetail
		}
	];
	if (bests.gauntlet.trackCount > 0) standard.push({
		mode: "GAUNTLET",
		value: formatClock(bests.gauntlet.timeMs / 1e3),
		detail: `${bests.gauntlet.trackCount} ${bests.gauntlet.trackCount === 1 ? "TRACK" : "TRACKS"}`
	});
	return standard;
}
function formatDecimal(value) {
	return Number.isInteger(value) ? String(value) : value.toFixed(1);
}
var ResultView = class {
	elements;
	durations;
	reducedMotion;
	current = null;
	signature = "";
	copyFeedbackTimer = 0;
	copyFeedbackGeneration = 0;
	constructor(elements, durations, reducedMotion) {
		this.elements = elements;
		this.durations = durations;
		this.reducedMotion = reducedMotion;
	}
	get secondaryAction() {
		return this.current?.secondary?.action ?? null;
	}
	render(result) {
		const signature = result ? JSON.stringify(result) : "";
		if (signature === this.signature) return;
		this.signature = signature;
		this.current = result;
		if (this.copyFeedbackTimer) {
			window.clearTimeout(this.copyFeedbackTimer);
			this.copyFeedbackTimer = 0;
		}
		this.copyFeedbackGeneration += 1;
		this.elements.secondaryLabel.classList.remove("fading");
		if (!result) {
			this.elements.title.textContent = "";
			this.elements.meta.replaceChildren();
			delete this.elements.meta.dataset.mode;
			this.elements.secondary.hidden = true;
			return;
		}
		this.elements.action.textContent = result.primaryLabel;
		this.elements.title.textContent = result.outcome;
		this.elements.meta.dataset.mode = result.mode;
		this.elements.meta.replaceChildren(...result.modules.map((module) => createResultModule(module)));
		this.elements.secondaryLabel.textContent = result.secondary?.label ?? "";
		if (result.secondary) this.elements.secondary.setAttribute("aria-label", result.secondary.ariaLabel);
		else this.elements.secondary.removeAttribute("aria-label");
		this.elements.secondary.hidden = result.secondary === null;
	}
	showShareCopied() {
		if (this.secondaryAction !== "share") return;
		if (this.copyFeedbackTimer) window.clearTimeout(this.copyFeedbackTimer);
		const generation = ++this.copyFeedbackGeneration;
		this.elements.secondaryLabel.classList.remove("fading");
		this.elements.secondaryLabel.textContent = "COPIED";
		this.copyFeedbackTimer = window.setTimeout(() => {
			this.copyFeedbackTimer = 0;
			if (this.secondaryAction === "share") this.swapSecondaryLabel("SHARE", generation);
		}, this.durations.shareVisible);
	}
	swapSecondaryLabel(text, generation) {
		const label = this.elements.secondaryLabel;
		if (label.textContent === text || this.reducedMotion.matches) {
			label.textContent = text;
			return;
		}
		label.classList.remove("fading");
		label.offsetWidth;
		label.classList.add("fading");
		window.setTimeout(() => {
			if (generation !== this.copyFeedbackGeneration) return;
			label.textContent = text;
			label.classList.remove("fading");
		}, this.durations.shareFade);
	}
};
function createResultModule(result) {
	const module = document.createElement("div");
	module.className = `result-module result-${result.kind}`;
	if (result.kind === "recap") {
		const items = document.createElement("div");
		items.className = "result-recap-items";
		items.replaceChildren(...result.items.map((item) => {
			const recap = document.createElement("div");
			recap.className = "result-recap-item";
			recap.replaceChildren(resultLine("result-recap-meta", item.meta), resultLine("result-recap-title", item.title));
			return recap;
		}));
		module.replaceChildren(createResultLabel(result.label), items);
		return module;
	}
	const value = document.createElement("span");
	value.className = "result-value";
	value.setAttribute("aria-label", resultModuleValue(result));
	value.replaceChildren(...result.kind === "track" ? [resultLine("result-track-title", result.value)] : createMetricLines(result.lines));
	module.replaceChildren(createResultLabel(result.label, result.newPersonalBest), value);
	return module;
}
function createResultLabel(text, personalBest = false) {
	const label = document.createElement("span");
	label.className = "result-label";
	if (personalBest) label.classList.add("new-personal-best");
	label.textContent = text;
	return label;
}
function createMetricLines(lines) {
	return lines.map((part, index) => resultLine(index === 0 ? "result-metric result-metric-primary" : "result-metric", part));
}
function resultLine(className, text) {
	const line = document.createElement("span");
	line.className = className;
	line.textContent = text;
	return line;
}
var TimelineView = class {
	elements;
	durations;
	reducedMotion;
	scheduler;
	motionGeneration = 0;
	progressTimer = 0;
	progressListener = null;
	timeAdjustmentTimer = 0;
	timeAdjustmentListener = null;
	timeAdjustmentGeneration = 0;
	positionFrame = 0;
	positionRevealKey = "";
	constructor(elements, durations, reducedMotion, scheduler = browserAnimationScheduler) {
		this.elements = elements;
		this.durations = durations;
		this.reducedMotion = reducedMotion;
		this.scheduler = scheduler;
	}
	setProgress(text, value) {
		const scale = Math.max(0, Math.min(1, Number(value) || 0));
		this.elements.now.textContent = text;
		this.elements.fill.style.transform = `scaleX(${scale})`;
		this.elements.feedback.style.transform = `scaleX(${scale})`;
	}
	renderPosition(state, onRevealComplete) {
		this.elements.timeline.classList.remove("position-resetting");
		if (!state) {
			this.cancelPositionReveal();
			this.elements.positionRange.disabled = true;
			this.elements.positionRange.value = "0";
			this.elements.positionRange.max = "0";
			this.elements.positionRange.setAttribute("aria-valuetext", "NO POSITION SELECTED");
			this.setPositionMarker(this.elements.positionGuess, null, 0);
			this.setPositionMarker(this.elements.positionActual, null, 0);
			this.hidePositionDistance();
			return;
		}
		const maximum = Math.max(0, state.maximumSecond);
		this.elements.positionRange.max = String(maximum);
		this.elements.positionRange.disabled = !state.interactionEnabled;
		const selected = state.selectedSecond;
		this.elements.positionRange.value = String(selected ?? 0);
		this.elements.positionRange.setAttribute("aria-valuetext", selected === null ? "NO POSITION SELECTED" : formatClock(selected));
		this.setPositionMarker(this.elements.positionGuess, selected, maximum);
		this.elements.now.textContent = selected === null ? "0:00" : formatClock(selected);
		if (state.phase === "selecting" || state.actualSecond === null) {
			this.cancelPositionReveal();
			this.elements.end.textContent = "?:??";
			this.setPositionMarker(this.elements.positionActual, null, maximum);
			this.hidePositionDistance();
			return;
		}
		if (state.phase === "revealed") {
			this.cancelPositionReveal();
			this.elements.end.textContent = formatClock(state.actualSecond);
			this.setPositionMarker(this.elements.positionActual, state.actualSecond, maximum);
			this.showPositionDistance(selected ?? 0, state.actualSecond, maximum);
			return;
		}
		const key = `${state.roundId}:${selected}:${state.actualSecond}`;
		if (key === this.positionRevealKey && this.positionFrame) return;
		this.cancelPositionReveal(false);
		this.positionRevealKey = key;
		this.elements.end.textContent = "0:00";
		this.setPositionMarker(this.elements.positionActual, 0, maximum);
		this.hidePositionDistance();
		if (this.reducedMotion.matches || this.durations.positionReveal <= 0) {
			this.elements.end.textContent = formatClock(state.actualSecond);
			this.setPositionMarker(this.elements.positionActual, state.actualSecond, maximum);
			this.showPositionDistance(selected ?? 0, state.actualSecond, maximum);
			queueMicrotask(() => onRevealComplete(state.roundId));
			return;
		}
		let startedAt = null;
		const animate = (now) => {
			if (this.positionRevealKey !== key) return;
			startedAt ??= now;
			const progress = Math.min(1, (now - startedAt) / this.durations.positionReveal);
			const accelerated = progress * progress;
			const revealedSecond = state.actualSecond * accelerated;
			this.elements.end.textContent = formatClock(revealedSecond);
			this.setPositionMarker(this.elements.positionActual, revealedSecond, maximum);
			if (progress < 1) {
				this.positionFrame = this.scheduler.requestFrame(animate);
				return;
			}
			this.positionFrame = 0;
			this.elements.end.textContent = formatClock(state.actualSecond);
			this.setPositionMarker(this.elements.positionActual, state.actualSecond, maximum);
			this.showPositionDistance(selected ?? 0, state.actualSecond, maximum);
			onRevealComplete(state.roundId);
		};
		this.positionFrame = this.scheduler.requestFrame(animate);
	}
	beginPositionReset() {
		this.cancelPositionReveal();
		this.elements.positionRange.disabled = true;
		this.elements.timeline.classList.add("position-resetting");
	}
	beginReset(rewindPlayback = false) {
		if (rewindPlayback && this.elements.timeline.classList.contains("progress-rewinding")) return;
		if (!rewindPlayback && this.progressListener && this.elements.fill.style.transition) return;
		const previousScale = this.progressScale();
		this.cancelProgressMotion();
		const generation = ++this.motionGeneration;
		if (rewindPlayback) {
			this.setProgress("0:00", 0);
			if (this.reducedMotion.matches || this.durations.rewind <= 0 || previousScale <= 1e-4) return;
			this.elements.timeline.style.setProperty("--rewind-from", String(previousScale));
			this.elements.timeline.offsetWidth;
			this.elements.timeline.classList.add("progress-rewinding");
			this.waitForProgressMotion("animationend", this.elements.timeline, this.durations.rewind, generation, (event) => {
				const animation = event;
				return !animation.animationName || animation.animationName === "corzaguessr-progress-rewind";
			});
			return;
		}
		if (this.reducedMotion.matches || this.durations.reset <= 0) return;
		this.elements.fill.style.transform = `scaleX(${previousScale})`;
		this.elements.fill.style.transition = "transform var(--duration-standard) ease-out";
		this.elements.fill.offsetWidth;
		this.waitForProgressMotion("transitionend", this.elements.fill, this.durations.reset, generation, (event) => {
			const transition = event;
			return !transition.propertyName || transition.propertyName === "transform";
		});
	}
	flashTimeAdjustment(seconds) {
		if (!seconds) return;
		this.clearTimeAdjustmentFeedback();
		this.elements.timeChangeText.textContent = seconds > 0 ? `+${seconds}S` : `${seconds}S`;
		if (this.durations.timeAdjustmentFeedback <= 0) {
			this.clearTimeAdjustmentFeedback();
			return;
		}
		if (this.reducedMotion.matches) this.elements.timeChange.classList.add("time-adjustment-static");
		else {
			this.elements.feedback.offsetWidth;
			this.elements.feedback.classList.add(seconds > 0 ? "time-adjustment-reward" : "time-adjustment-penalty");
			this.elements.timeChange.classList.add("time-adjustment-active");
		}
		const generation = ++this.timeAdjustmentGeneration;
		const finish = () => {
			if (generation !== this.timeAdjustmentGeneration) return;
			this.clearTimeAdjustmentFeedback();
		};
		if (!this.reducedMotion.matches) {
			this.timeAdjustmentListener = (event) => {
				const animation = event;
				if (event.target === this.elements.timeChangeText && (!animation.animationName || animation.animationName === "corzaguessr-time-adjustment-hit")) finish();
			};
			this.elements.timeChangeText.addEventListener("animationend", this.timeAdjustmentListener);
		}
		this.timeAdjustmentTimer = this.scheduler.setTimer(finish, this.durations.timeAdjustmentFeedback);
	}
	clearTimeAdjustmentFeedback() {
		this.timeAdjustmentGeneration += 1;
		if (this.timeAdjustmentTimer) this.scheduler.clearTimer(this.timeAdjustmentTimer);
		this.timeAdjustmentTimer = 0;
		if (this.timeAdjustmentListener) this.elements.timeChangeText.removeEventListener("animationend", this.timeAdjustmentListener);
		this.timeAdjustmentListener = null;
		this.elements.feedback.classList.remove("time-adjustment-reward", "time-adjustment-penalty");
		this.elements.timeChange.classList.remove("time-adjustment-active", "time-adjustment-static");
		this.elements.timeChangeText.textContent = "";
	}
	setPositionMarker(marker, second, maximum) {
		marker.hidden = second === null;
		if (second === null) {
			marker.style.left = "";
			return;
		}
		const percentage = maximum > 0 ? second / maximum * 100 : 0;
		marker.style.left = `clamp(var(--gradient-border-width), ${percentage}%, calc(100% - var(--gradient-border-width)))`;
	}
	showPositionDistance(guessed, actual, maximum) {
		const start = Math.min(guessed, actual);
		const distance = Math.abs(guessed - actual);
		this.elements.positionDistance.hidden = false;
		this.elements.positionDistance.style.left = `${maximum > 0 ? start / maximum * 100 : 0}%`;
		this.elements.positionDistance.style.width = `${maximum > 0 ? distance / maximum * 100 : 0}%`;
	}
	hidePositionDistance() {
		this.elements.positionDistance.hidden = true;
		this.elements.positionDistance.style.left = "";
		this.elements.positionDistance.style.width = "";
	}
	cancelPositionReveal(clearKey = true) {
		if (this.positionFrame) this.scheduler.cancelFrame(this.positionFrame);
		this.positionFrame = 0;
		if (clearKey) this.positionRevealKey = "";
	}
	progressScale() {
		const computed = getComputedStyle(this.elements.fill).transform;
		const transform = computed && computed !== "none" ? computed : this.elements.fill.style.transform;
		const scaleMatch = /scaleX\(([^)]+)\)/.exec(transform);
		const matrixMatch = /^matrix(?:3d)?\(([^)]+)\)$/.exec(transform);
		const value = scaleMatch ? Number.parseFloat(scaleMatch[1] ?? "") : matrixMatch ? Number.parseFloat(matrixMatch[1]?.split(",")[0] ?? "") : 0;
		return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 0;
	}
	waitForProgressMotion(eventName, target, duration, generation, accepts) {
		const finish = () => {
			if (generation !== this.motionGeneration) return;
			this.cancelProgressMotion(false);
		};
		this.progressListener = (event) => {
			if (event.target === target && accepts(event)) finish();
		};
		target.addEventListener(eventName, this.progressListener);
		this.progressTimer = this.scheduler.setTimer(finish, duration);
	}
	cancelProgressMotion(invalidate = true) {
		if (invalidate) this.motionGeneration += 1;
		if (this.progressTimer) this.scheduler.clearTimer(this.progressTimer);
		this.progressTimer = 0;
		if (this.progressListener) {
			this.elements.timeline.removeEventListener("animationend", this.progressListener);
			this.elements.fill.removeEventListener("transitionend", this.progressListener);
		}
		this.progressListener = null;
		this.elements.timeline.classList.remove("progress-rewinding");
		this.elements.timeline.style.removeProperty("--rewind-from");
		this.elements.fill.style.transition = "";
	}
};
var barCount = 8;
var VolumeControl = class {
	container;
	input;
	bars;
	handler = null;
	constructor(container, input, initialVolume) {
		this.container = container;
		this.input = input;
		this.bars = [...container.querySelectorAll(".volume-bar")];
		if (this.bars.length !== barCount) throw new Error(`Corzaguessr volume control requires ${barCount} bars.`);
		this.input.value = String(initialVolume);
		this.render(initialVolume);
		this.input.addEventListener("input", () => {
			const volume = Number(this.input.value);
			this.render(volume);
			this.handler?.(volume, false);
		});
		this.input.addEventListener("change", () => {
			this.handler?.(Number(this.input.value), true);
		});
	}
	bind(handler) {
		this.handler = handler;
	}
	render(volume) {
		const activeBars = volume === 0 ? 0 : Math.ceil(volume * barCount / 100);
		this.container.classList.toggle("muted", volume === 0);
		this.input.setAttribute("aria-valuetext", volume === 0 ? "Muted" : `${volume} percent`);
		this.bars.forEach((bar, index) => {
			bar.classList.toggle("active", index < activeBars);
		});
	}
};
var icons = {
	play: "M8 5v14l11-7z",
	pause: "M6 5h4v14H6zM14 5h4v14h-4z",
	stop: "M7 7h10v10H7z"
};
var GameView = class {
	root;
	audioElements;
	modal;
	elements;
	modeButtons;
	reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
	finePointer = matchMedia("(pointer: fine)");
	autocomplete;
	attempts;
	timeline;
	volume;
	discovery;
	progressSummary;
	resultView;
	durations;
	handlers = null;
	state = null;
	sessionKey = null;
	inputModality;
	hoveredButton = null;
	preview = null;
	rulesSignature = "";
	announcementFrame = 0;
	constructor(root, initialVolume = 100, coverUrl = (dailyNumber) => `covers/${trackAssetNumber(dailyNumber)}.webp`) {
		this.root = root;
		this.inputModality = this.finePointer.matches ? "pointer-fine" : "pointer-coarse";
		root.dataset.corzaguessrReady = "true";
		root.innerHTML = markup();
		this.elements = this.queryElements();
		this.audioElements = this.elements.audioPlayers;
		this.modeButtons = Object.fromEntries(regularModes.map((mode) => [mode, this.required(`[data-mode="${mode}"]`)]));
		const styles = getComputedStyle(root);
		this.durations = {
			fast: duration(styles, "--duration-fast"),
			standard: duration(styles, "--duration-standard"),
			long: duration(styles, "--duration-long")
		};
		this.resultView = new ResultView({
			action: this.elements.resultAction,
			secondary: this.elements.resultSecondary,
			secondaryLabel: this.elements.resultSecondaryLabel,
			title: this.elements.resultTitle,
			meta: this.elements.resultMeta
		}, {
			shareVisible: this.durations.long,
			shareFade: this.durations.fast
		}, this.reducedMotion);
		this.modal = new ModalController(root, this.elements, this.durations.standard, this.reducedMotion, (message) => this.announce(message));
		this.autocomplete = new Autocomplete(this.elements.guess, this.elements.suggest, (id) => this.handlers?.guess(id), () => this.handlers?.playbackShortcut());
		this.attempts = new AttemptHistoryView({
			container: this.required(".attempt-area"),
			list: this.elements.slots
		}, {
			wiggle: this.durations.long,
			collapse: this.durations.standard
		}, this.reducedMotion);
		this.timeline = new TimelineView({
			timeline: this.elements.timeline,
			now: this.elements.now,
			fill: this.elements.fill,
			feedback: this.elements.feedback,
			timeChange: this.elements.timeChange,
			timeChangeText: this.elements.timeChangeText,
			end: this.elements.endtime,
			positionRange: this.elements.positionRange,
			positionGuess: this.elements.positionGuess,
			positionActual: this.elements.positionActual,
			positionDistance: this.elements.positionDistance
		}, {
			reset: this.durations.standard,
			rewind: this.durations.fast,
			timeAdjustmentFeedback: this.durations.long,
			positionReveal: this.durations.long
		}, this.reducedMotion);
		this.volume = new VolumeControl(this.elements.volumeControl, this.elements.volumeRange, initialVolume);
		this.discovery = new DiscoveryListView(this.elements.discoveryCount, this.elements.discoveryItems, coverUrl);
		this.progressSummary = new ProgressSummaryView(this.elements.progressBests);
	}
	bind(handlers) {
		this.handlers = handlers;
		this.volume.bind(handlers.setVolume);
		this.discovery.bind(handlers.openDiscoverySpotify, handlers.startGauntlet);
		this.elements.play.addEventListener("click", handlers.play);
		this.elements.skip.addEventListener("click", handlers.skip);
		this.elements.positionRange.addEventListener("input", () => {
			handlers.selectPositionSecond(Number(this.elements.positionRange.value));
		});
		this.elements.resultAction.addEventListener("click", handlers.resultAction);
		this.elements.resultSecondary.addEventListener("click", () => {
			const action = this.resultView.secondaryAction;
			if (action === "share") handlers.shareDaily();
			else if (action === "spotify") handlers.openSpotify();
		});
		this.elements.discoveryButton.addEventListener("click", handlers.openDiscovery);
		this.elements.discoveryClose.addEventListener("click", handlers.closeDiscovery);
		this.elements.discoveryModal.addEventListener("click", (event) => {
			if (!(event.target instanceof Element && event.target.closest(".discovery-panel"))) handlers.closeDiscovery();
		});
		for (const mode of regularModes) {
			const button = this.modeButtons[mode];
			button.addEventListener("click", () => handlers.selectMode(mode));
			this.bindPreview(button, mode);
		}
		this.bindPreview(this.elements.discoveryButton, "discovery");
		this.root.addEventListener("keydown", (event) => this.handleRootKeydown(event), true);
		this.root.addEventListener("pointermove", (event) => this.handlePointerMove(event));
		this.root.addEventListener("pointerdown", (event) => this.handlePointerDown(event));
		this.root.addEventListener("pointerleave", () => {
			this.hoveredButton = null;
		});
	}
	render(state, sessionKey) {
		if (this.modal.resultClosing) return;
		const previousOverlay = this.state?.overlay ?? null;
		const sessionChanged = this.sessionKey !== null && this.sessionKey !== sessionKey;
		const openingOverlay = state.overlay !== previousOverlay ? state.overlay : null;
		this.state = state;
		this.sessionKey = sessionKey;
		if (sessionChanged) this.timeline.beginReset();
		if (sessionChanged || openingOverlay) this.resetTransientUi();
		const transportVisible = state.transportText !== "";
		this.root.classList.toggle("rules-visible", !state.inputVisible || transportVisible);
		this.root.classList.toggle("mode-selected", state.mode !== null);
		this.root.classList.toggle("timed", isTimedMode(state.mode));
		this.root.classList.toggle("position", isPositionMode(state.mode));
		const awaiting = state.appStatus === "awaiting-mode";
		this.elements.modePrompt.setAttribute("aria-hidden", String(!awaiting));
		this.elements.play.disabled = !state.playEnabled;
		this.elements.skip.disabled = !state.actionEnabled;
		this.autocomplete.setSuspended(!state.attemptEnabled);
		const blockedBoard = awaiting || state.appStatus === "loading";
		const overlay = state.overlay !== null;
		this.elements.headerAction.inert = overlay;
		this.elements.modes.inert = overlay;
		this.elements.board.inert = overlay;
		this.elements.slots.inert = overlay || blockedBoard;
		for (const mode of regularModes) {
			const button = this.modeButtons[mode];
			const selected = mode === state.mode;
			button.disabled = state.appStatus === "error" && !state.tracks.length || selected || state.overlay === "discovery";
			button.setAttribute("aria-pressed", String(selected));
		}
		this.elements.icon.setAttribute("d", icons[state.playbackIcon]);
		this.elements.play.setAttribute("aria-label", state.playbackIcon === "play" ? "PLAY" : state.playbackIcon === "pause" ? "PAUSE" : "STOP");
		this.elements.skip.textContent = state.skipText;
		if (state.snippetSeconds !== null) this.elements.snippet.style.width = snippetPercentage(state.snippetSeconds);
		this.renderRules();
		this.attempts.render(state.slots, sessionKey);
		this.autocomplete.setDependencies(state.tracks, state.unavailableGuessIds, state.mode === "daily" ? state.dailyDate : null);
		if (state.overlay === "discovery") {
			this.renderDiscovery(state);
			this.progressSummary.render(state.personalBests, state.dailyProgress, state.dailyDate);
		}
		if (state.result || !this.modal.resultLayoutActive) this.resultView.render(state.result);
		this.renderClock(state.clock);
		this.timeline.renderPosition(state.positionTimeline, (roundId) => this.handlers?.positionRevealComplete(roundId));
		if (openingOverlay === "result") this.modal.openResult(state.result?.announcement);
		else if (openingOverlay === "discovery") {
			this.discovery.collapseAll();
			this.modal.openDiscovery();
		}
	}
	renderClock(clock) {
		this.elements.endtime.textContent = clock.endText;
		this.timeline.setProgress(clock.currentText, clock.progress);
	}
	announce(message) {
		cancelAnimationFrame(this.announcementFrame);
		this.announcementFrame = 0;
		this.elements.status.textContent = "";
		if (message) this.announcementFrame = requestAnimationFrame(() => {
			this.announcementFrame = 0;
			this.elements.status.textContent = message;
		});
	}
	focusAfterCatalogReady() {
		this.state?.mode ? this.focusPlay() : this.focusMode("daily");
	}
	focusAfterModeSelected() {
		if (this.state?.mode === "daily" && dailyCompleted(this.state.dailyProgress, this.state.dailyDate)) this.focusMode("classic");
		else this.focusPlay();
	}
	resetTimeline() {
		this.timeline.beginReset(true);
	}
	resetGuessInput() {
		this.autocomplete.reset();
	}
	flashTimeChange(seconds) {
		this.timeline.flashTimeAdjustment(seconds);
	}
	beginResultClose(id, focus, resetBoard = false) {
		const target = focus === "classic" ? this.modeButtons.classic : this.elements.play;
		this.modal.closeResult(target, () => {
			this.resultView.render(null);
			this.handlers?.resultClosed(id);
		}, resetBoard ? () => this.beginBoardReset() : void 0);
	}
	beginDiscoveryClose(request, id) {
		return this.modal.closeDiscovery(this.elements.discoveryButton, () => this.handlers?.discoveryClosed(id), () => {
			const target = request.outcome === "start-gauntlet" || this.state?.mode ? this.elements.play : this.elements.discoveryButton;
			return !target.disabled && !target.closest("[inert]") ? target : null;
		});
	}
	showDailyShareCopied() {
		this.resultView.showShareCopied();
	}
	resetTransientUi() {
		cancelAnimationFrame(this.announcementFrame);
		this.elements.status.textContent = "";
		this.timeline.clearTimeAdjustmentFeedback();
		this.preview = null;
		this.autocomplete.reset();
		this.renderRules();
	}
	beginBoardReset() {
		this.timeline.beginReset();
		const mode = this.state?.mode ?? null;
		this.timeline.setProgress(mode === "blitz" ? "1:00" : "0:00", isTimedMode(mode) ? 1 : 0);
		if (isPositionMode(mode)) this.timeline.beginPositionReset();
		const snippetSeconds = isPositionMode(this.state?.mode ?? null) ? this.state?.snippetSeconds ?? snippetDurations[0] : snippetDurations[0];
		this.elements.snippet.style.width = snippetPercentage(snippetSeconds);
		this.attempts.beginReset();
	}
	focusPlay() {
		if (!this.elements.play.disabled && !this.elements.play.closest("[inert]")) this.elements.play.focus({ preventScroll: true });
	}
	focusProgress() {
		this.elements.discoveryButton.focus({ preventScroll: true });
	}
	focusAttemptAction() {
		if (!this.elements.skip.disabled && !this.elements.skip.closest("[inert]")) this.elements.skip.focus({ preventScroll: true });
	}
	focusMode(mode) {
		const button = this.modeButtons[mode];
		if (!button.disabled && !button.closest("[inert]")) button.focus({ preventScroll: true });
	}
	focusGuess() {
		if (this.inputModality === "pointer-coarse") return;
		const target = isPositionMode(this.state?.mode ?? null) ? this.elements.positionRange : this.elements.guess;
		if (!target.disabled && !target.closest("[inert]")) queueMicrotask(() => target.focus({ preventScroll: true }));
	}
	renderRules() {
		if (!this.state) return;
		const text = this.state.transportText || (!this.preview || this.preview === this.state.mode ? this.state.rulesText : this.preview === "discovery" ? copy.progress : modeRules[this.preview].description);
		const scroll = !this.state.transportText && !this.reducedMotion.matches && !this.state.inputVisible;
		const signature = JSON.stringify([text, scroll]);
		if (signature === this.rulesSignature) return;
		this.rulesSignature = signature;
		this.elements.modePrompt.textContent = text;
		this.elements.rulesetText.textContent = text;
		this.elements.rulesetCopy.textContent = text;
		this.elements.ruleset.classList.remove("scroll");
		if (scroll) {
			this.elements.ruleset.offsetWidth;
			this.elements.ruleset.classList.add("scroll");
		}
	}
	renderDiscovery(state) {
		this.discovery.render(state.tracks, state.discoveries);
	}
	bindPreview(element, preview) {
		element.addEventListener("pointerenter", () => {
			if (this.finePointer.matches && this.previewAllowed()) {
				this.preview = preview;
				this.renderRules();
			}
		});
		element.addEventListener("pointerleave", () => {
			if (this.preview === preview) {
				this.preview = null;
				this.renderRules();
			}
		});
		element.addEventListener("focus", () => {
			if (this.inputModality === "keyboard" && this.previewAllowed()) {
				this.preview = preview;
				this.renderRules();
			}
		});
		element.addEventListener("blur", () => {
			if (this.preview === preview) {
				this.preview = null;
				this.renderRules();
			}
		});
	}
	previewAllowed() {
		return !!this.state && ["awaiting-mode", "ready"].includes(this.state.appStatus) && this.state.overlay === null && !this.state.inputVisible;
	}
	handleRootKeydown(event) {
		if (!this.handlers || !this.state) return;
		const pointerAnchor = this.inputModality === "pointer-fine" && this.hoveredButton && this.canNavigateTo(this.hoveredButton) ? this.hoveredButton : null;
		const guessOwnsInput = this.state.attemptEnabled && document.activeElement === this.elements.guess;
		const hoveredAction = pointerAnchor && !guessOwnsInput && (event.key === "Enter" || event.key === " ") ? pointerAnchor : null;
		this.setInputModality("keyboard");
		if (hoveredAction) {
			event.preventDefault();
			this.hoveredButton = null;
			hoveredAction.click();
			return;
		}
		if (this.state.overlay) {
			if (event.key === "Escape") {
				event.preventDefault();
				this.state.overlay === "discovery" ? this.handlers.closeDiscovery() : this.handlers.resultAction();
				return;
			}
			if (this.state.overlay === "result" && event.key === "Enter" && document.activeElement !== this.elements.resultSecondary) {
				event.preventDefault();
				this.handlers.resultAction();
				return;
			}
			if (this.isArrowKey(event.key)) {
				event.preventDefault();
				this.moveModalFocus(this.state.overlay, event.key, pointerAnchor);
				return;
			}
			this.modal.trapFocus(event);
			return;
		}
		const target = event.target instanceof Element ? event.target : null;
		if (this.isArrowKey(event.key)) {
			if (target === this.elements.volumeRange || target === this.elements.positionRange) return;
			if (target === this.elements.guess && this.state.inputVisible) return;
			if (this.state.inputVisible && this.state.attemptEnabled) {
				event.preventDefault();
				this.focusGuess();
				return;
			}
			event.preventDefault();
			this.movePrimaryFocus(event.key, pointerAnchor);
			return;
		}
		if (event.key === "Enter" && this.state.appStatus !== "awaiting-mode" && (target === this.elements.positionRange || !target?.closest("button, input, a, .suggest"))) {
			event.preventDefault();
			this.handlers.playbackShortcut();
		}
	}
	isArrowKey(key) {
		return key === "ArrowUp" || key === "ArrowDown" || key === "ArrowLeft" || key === "ArrowRight";
	}
	moveModalFocus(overlay, key, pointerAnchor) {
		const candidates = overlay === "result" ? [this.elements.resultAction, this.elements.resultSecondary] : [this.elements.discoveryClose];
		this.cycleFocus(candidates, key, candidates[0], pointerAnchor);
	}
	movePrimaryFocus(key, pointerAnchor) {
		const elements = {
			discovery: this.elements.discoveryButton,
			...this.modeButtons,
			play: this.elements.play
		};
		const entries = Object.entries(elements);
		const enabled = new Set(entries.filter(([, element]) => this.canNavigateTo(element)).map(([id]) => id));
		const currentElement = pointerAnchor && this.canNavigateTo(pointerAnchor) ? pointerAnchor : document.activeElement;
		const current = entries.find(([, element]) => element === currentElement)?.[0] ?? null;
		const completedDaily = this.state?.mode === "daily" && dailyCompleted(this.state.dailyProgress, this.state.dailyDate);
		const target = nextPrimaryFocus({
			current,
			enabled,
			selectedMode: this.state?.mode ?? null,
			completedDaily
		}, key);
		this.focusIfAvailable(target ? elements[target] : null);
	}
	focusIfAvailable(element) {
		if (element && this.canNavigateTo(element)) element.focus({ preventScroll: true });
	}
	cycleFocus(candidates, key, recommended, pointerAnchor) {
		const focusable = candidates.filter((element) => this.canNavigateTo(element));
		if (!focusable.length) return;
		const current = pointerAnchor && focusable.includes(pointerAnchor) ? pointerAnchor : document.activeElement;
		const currentIndex = focusable.indexOf(current);
		if (currentIndex < 0) {
			(focusable.includes(recommended) ? recommended : focusable[0]).focus({ preventScroll: true });
			return;
		}
		focusable[(currentIndex + (key === "ArrowLeft" || key === "ArrowUp" ? -1 : 1) + focusable.length) % focusable.length].focus({ preventScroll: true });
	}
	canNavigateTo(element) {
		if (!element.isConnected || element.hidden || element.closest("[inert]")) return false;
		if (element instanceof HTMLButtonElement && element.disabled) return false;
		return element.offsetParent !== null;
	}
	handlePointerMove(event) {
		if (event.pointerType !== "mouse" || !this.finePointer.matches) return;
		this.setInputModality("pointer-fine");
		const button = event.target instanceof Element ? event.target.closest("button") : null;
		this.hoveredButton = button instanceof HTMLButtonElement && this.canNavigateTo(button) ? button : null;
	}
	handlePointerDown(event) {
		if (!this.handlers || !this.state) return;
		const modality = event.pointerType === "mouse" && this.finePointer.matches ? "pointer-fine" : "pointer-coarse";
		this.setInputModality(modality);
		const target = event.target instanceof Element ? event.target : null;
		const button = target?.closest("button");
		this.hoveredButton = modality === "pointer-fine" && button instanceof HTMLButtonElement && this.canNavigateTo(button) ? button : null;
		if (modality === "pointer-fine" && document.activeElement === this.elements.guess && target?.closest("button")) {
			event.preventDefault();
			return;
		}
		if (this.state.playEnabled && !this.state.inputVisible && !target?.closest("button, input, a, .suggest")) {
			event.preventDefault();
			this.focusPlay();
			return;
		}
		if (!this.state.attemptEnabled || this.state.overlay || target?.closest("button, input, a, .suggest")) return;
		this.elements.guess.focus({ preventScroll: true });
	}
	setInputModality(modality) {
		this.inputModality = modality;
		if (modality === "keyboard") this.hoveredButton = null;
		this.root.classList.toggle("keyboard-input", modality === "keyboard");
	}
	required(selector) {
		const element = this.root.querySelector(selector);
		if (!element) throw new Error(`Missing Corzaguessr element: ${selector}`);
		return element;
	}
	queryElements() {
		const audioPlayers = [...this.root.querySelectorAll(".audio")];
		if (audioPlayers.length !== 2) throw new Error("Corzaguessr requires two audio elements.");
		const resultSecondary = this.required(".result-secondary");
		const resultSecondaryLabel = document.createElement("span");
		resultSecondaryLabel.className = "result-secondary-label";
		resultSecondary.append(resultSecondaryLabel);
		return {
			headerAction: this.required(".header-action"),
			modes: this.required(".modes"),
			board: this.required(".board"),
			slots: this.required(".slots"),
			card: this.required(".card"),
			play: this.required(".play"),
			skip: this.required(".skip"),
			guess: this.required(".guess"),
			suggest: this.required(".suggest"),
			icon: this.required(".icon path"),
			snippet: this.required(".snippet"),
			now: this.required(".now"),
			endtime: this.required(".endtime"),
			fill: this.required(".fill"),
			feedback: this.required(".feedback"),
			timeline: this.required(".timeline"),
			timeChange: this.required(".time-change"),
			timeChangeText: this.required(".time-change span"),
			positionRange: this.required(".position-range"),
			positionGuess: this.required(".position-guess"),
			positionActual: this.required(".position-actual"),
			positionDistance: this.required(".position-distance"),
			ruleset: this.required(".ruleset"),
			rulesetText: this.required(".ruleset-text"),
			rulesetCopy: this.required(".ruleset-copy"),
			modePrompt: this.required(".mode-prompt"),
			status: this.required(".status"),
			resultAction: this.required(".result-action"),
			resultSecondary,
			resultSecondaryLabel,
			result: this.required(".result-modal"),
			resultShell: this.required(".result-shell"),
			resultPanel: this.required(".result-modal .corzaguessr-modal"),
			resultTitle: this.required("#corzaguessr-result-title"),
			resultMeta: this.required("#corzaguessr-result-meta"),
			discoveryButton: this.required(".discovery-button"),
			discoveryModal: this.required(".discovery-modal"),
			discoveryShell: this.required(".discovery-shell"),
			discoveryPanel: this.required(".discovery-panel"),
			discoveryClose: this.required(".discovery-close"),
			discoveryCount: this.required(".discovery-title small"),
			discoveryItems: this.required(".discovery-items"),
			progressBests: this.required(".progress-bests"),
			volumeControl: this.required(".volume-control"),
			volumeRange: this.required(".volume-range"),
			audioPlayers
		};
	}
};
function duration(styles, name) {
	const value = styles.getPropertyValue(name).trim();
	return value.endsWith("ms") ? Number.parseFloat(value) || 0 : value.endsWith("s") ? (Number.parseFloat(value) || 0) * 1e3 : 0;
}
function snippetPercentage(seconds) {
	return `${seconds / maxPuzzleSnippetSeconds * 100}%`;
}
function markup() {
	const snippetTicks = snippetDurations.slice(0, -1).map((seconds) => `<i class="tick" style="left:${snippetPercentage(seconds)}"></i>`).join("");
	return [
		`<div class="wrap">`,
		`<h1>CORZAGUESSR&#10022;</h1>`,
		`<div class="row header-action"><button type="button" class="button discovery-button glass" aria-controls="corzaguessr-discovery" aria-expanded="false"><span>PROGRESS</span></button></div>
    <div class="game-surface"><div class="modes mode-navigation glass" aria-label="GAME MODE">${regularModes.map((mode) => `<button type="button" class="mode" data-mode="${mode}" aria-pressed="false">${mode.toUpperCase()}</button>`).join("")}</div>`,
		`<div class="card glass">`,
		`<div class="stack">`,
		`<div class="board">`,
		`<div class="controls"><div class="time"><span class="now">0:00</span></div><button type="button" class="play" aria-label="PLAY" disabled><svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="${icons.play}"></path></svg></button><div class="time"><span class="endtime">0:01</span></div></div>`,
		`<div class="volume-control"><div class="volume-bars" aria-hidden="true"><i class="volume-bar"></i><i class="volume-bar"></i><i class="volume-bar"></i><i class="volume-bar"></i><i class="volume-bar"></i><i class="volume-bar"></i><i class="volume-bar"></i><i class="volume-bar"></i></div><input class="volume-range" type="range" min="0" max="100" step="1" value="100" aria-label="VOLUME" aria-valuetext="100 percent"></div>`,
		`<div class="timeline"><div class="snippet" style="width:${snippetPercentage(snippetDurations[0])}"></div><div class="fill"></div><div class="feedback"></div><div class="position-distance" hidden></div><div class="position-marker position-guess" hidden></div><div class="position-marker position-actual" hidden></div><input class="position-range" type="range" min="0" max="0" step="1" value="0" aria-label="SELECT SONG POSITION" aria-valuetext="NO POSITION SELECTED" disabled><div class="time-change"><span></span></div>${snippetTicks}</div>`,
		`<div class="guess-lane"><div class="auto"><label class="sr-only" for="corzaguessr-guess">SEARCH FOR A TRACK</label><input id="corzaguessr-guess" class="guess" placeholder="HAVE A GUESS? SEARCH FOR IT HERE!" autocomplete="off" role="combobox" aria-autocomplete="list" aria-controls="corzaguessr-suggestions" aria-expanded="false" disabled><div class="ruleset" aria-hidden="true"><div class="ruleset-track"><span class="ruleset-text">${copy.modePrompt}</span><span class="ruleset-copy">${copy.modePrompt}</span></div></div><div id="corzaguessr-suggestions" class="suggest" role="listbox"></div></div><div class="row skip-row"><button type="button" class="button skip" disabled>ADD 1S</button></div></div>`,
		`</div>`,
		`<div class="attempt-area" aria-live="polite" aria-relevant="additions text"><div class="slots"></div></div>`,
		`</div>`,
		`<div class="result-modal" aria-hidden="true"><div class="result-shell"><div class="corzaguessr-modal glass" role="dialog" aria-modal="true" aria-labelledby="corzaguessr-result-title" aria-describedby="corzaguessr-result-meta" tabindex="-1"><h3 id="corzaguessr-result-title" class="modal-title"></h3><div id="corzaguessr-result-meta" class="result-meta"></div><div class="actions"><button type="button" class="button result-action">NEW GAME</button><button type="button" class="button result-secondary" hidden></button></div></div></div></div>`,
		`<div id="corzaguessr-discovery" class="discovery-modal" role="dialog" aria-modal="true" aria-label="PROGRESS" aria-hidden="true" tabindex="-1"><div class="discovery-shell"><div class="discovery-panel glass"><div class="discovery-title"><span>DISCOVERY</span><small>0 / 0 (0%)</small></div><div class="discovery-items" role="list"></div><section class="progress-summary" aria-labelledby="corzaguessr-records-title"><h4 id="corzaguessr-records-title">RECORDS</h4><div class="progress-bests"></div></section><div class="actions"><button type="button" class="button discovery-close">CLOSE</button></div></div></div></div>`,
		`</div>`,
		`</div>`,
		`<p class="mode-prompt" role="status" aria-hidden="false">${copy.modePrompt}</p>`,
		`</div>`,
		`<p class="sr-only status" aria-live="polite"></p>`,
		`<audio class="audio" preload="metadata" playsinline aria-hidden="true" hidden></audio>`,
		`<audio class="audio" preload="metadata" playsinline aria-hidden="true" hidden></audio>`
	].join("");
}
var saveKey = "corzaguessr:rewrite:save";
function defaults() {
	return {
		version: 1,
		discoveries: [],
		daily: null,
		classic: null,
		records: emptyPersonalBests(),
		volume: 100
	};
}
function record(v) {
	return !!v && typeof v === "object" && !Array.isArray(v);
}
function integer(v, min = 0, max = Number.MAX_SAFE_INTEGER) {
	return Number.isSafeInteger(v) && Number(v) >= min && Number(v) <= max;
}
function puzzleAttempts(v, allowCompleted) {
	return Array.isArray(v) && v.length <= (allowCompleted ? 6 : 5) && v.every((a, i) => record(a) && (a.outcome === "skip" ? a.trackNumber === null : integer(a.trackNumber, 1)) && (a.outcome === "wrong" || a.outcome === "skip" || allowCompleted && i === 0 && a.outcome === "correct"));
}
function parseRecords(value) {
	const result = emptyPersonalBests();
	if (!record(value)) return result;
	const { classic: c, blitz: b, seek: s, gauntlet: g } = value;
	const total = (count, sum) => integer(sum, count, count * 32);
	if (record(c) && integer(c.current) && integer(c.best, c.current) && total(c.current, c.snippetTotal) && total(c.best, c.bestSnippetTotal) && (c.best !== c.current || c.bestSnippetTotal <= c.snippetTotal)) result.classic = {
		current: c.current,
		best: c.best,
		snippetTotal: c.snippetTotal,
		bestSnippetTotal: c.bestSnippetTotal
	};
	if (record(b) && integer(b.score) && (b.score === 0 ? b.accuracy === null : integer(b.accuracy, 0, 100))) result.blitz = {
		score: b.score,
		accuracy: b.accuracy
	};
	if (record(s) && integer(s.score, 0, 5e3)) result.seek = { score: s.score };
	if (record(g) && integer(g.timeMs) && g.timeMs % 1e3 === 0 && integer(g.trackCount) && (g.trackCount > 0 || g.timeMs === 0)) result.gauntlet = {
		timeMs: g.timeMs,
		trackCount: g.trackCount
	};
	return result;
}
function parseSave(value) {
	const result = defaults();
	if (!record(value) || value.version !== 1) return result;
	if (Array.isArray(value.discoveries) && value.discoveries.every((id) => integer(id, 1))) result.discoveries = [...new Set(value.discoveries)];
	const d = value.daily;
	if (record(d) && isIsoDate(d.date) && integer(d.dailyNumber, 1) && puzzleAttempts(d.attempts, true)) result.daily = {
		date: d.date,
		dailyNumber: d.dailyNumber,
		attempts: d.attempts.map((a) => ({ ...a }))
	};
	const c = value.classic;
	if (record(c) && integer(c.dailyNumber, 1) && integer(c.clipStart) && puzzleAttempts(c.attempts, false)) result.classic = {
		dailyNumber: c.dailyNumber,
		clipStart: c.clipStart,
		attempts: c.attempts.map((a) => ({ ...a }))
	};
	result.records = parseRecords(value.records);
	if (integer(value.volume, 0, 100)) result.volume = value.volume;
	return result;
}
var SaveWriter = class {
	storage;
	dirty = false;
	constructor(storage = browserStorage()) {
		this.storage = storage;
	}
	load() {
		try {
			return parseSave(JSON.parse(this.storage?.getItem("corzaguessr:rewrite:save") ?? "null"));
		} catch {
			return defaults();
		}
	}
	write(data) {
		try {
			if (!this.storage) throw new Error("Storage unavailable");
			this.storage.setItem(saveKey, JSON.stringify(data));
			this.dirty = false;
			return true;
		} catch {
			this.dirty = true;
			return false;
		}
	}
};
function browserStorage() {
	try {
		return window.localStorage;
	} catch {
		return null;
	}
}
async function copyToClipboard(text, target = navigator) {
	try {
		if (!target.clipboard) return false;
		await target.clipboard.writeText(text);
		return true;
	} catch {
		return false;
	}
}
function openSpotify(trackId) {
	window.open(`https://open.spotify.com/track/${trackId}`, "_blank", "noopener,noreferrer");
}
var root = document.querySelector("#corzaguessr");
if (root && !root.dataset.corzaguessrReady) {
	const assets = new URL("https://cdn.jsdelivr.net/gh/HankeyThePoo/corzaguessr@main/");
	const storage = new SaveWriter();
	const view = new GameView(root, storage.load().volume, (id) => new URL(`covers/${trackAssetNumber(id)}.webp`, assets).href);
	const moduleUrl = new URL(import.meta.url);
	const catalogUrl = new URL("tracks.json", moduleUrl);
	catalogUrl.search = moduleUrl.search;
	new Application({
		view,
		storage,
		catalogUrl,
		copy: copyToClipboard,
		openSpotify,
		audioUrl: (round) => new URL(`tracks/${trackAssetNumber(round.track.dailyNumber)}.mp3#t=${round.clipStart}`, assets).href
	}).start();
}
