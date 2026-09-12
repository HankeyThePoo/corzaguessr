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
		description: "PLAY HEARDLE-STYLE ROUNDS AND BUILD YOUR STREAK",
		howToPlay: ["Keep playing the same 6-attempt guessing format, one song after another, and build your streak. Each wrong guess or skip unlocks a longer audio snippet.", "You may occasionally encounter an upcoming song. These Preview rounds do not affect your streak."],
		gameplay: "puzzle",
		clockDisplay: "snippet",
		failurePolicy: "heard-fixed",
		prefetchRounds: false
	},
	daily: {
		initialTimeMs: null,
		description: "GUESS TODAY'S SHARED SONG IN 6 ATTEMPTS",
		howToPlay: ["Guess today's song in 6 attempts. Each wrong guess or skip unlocks a longer audio snippet. Everyone gets the same song, with a new Daily every day."],
		gameplay: "puzzle",
		clockDisplay: "snippet",
		failurePolicy: "fixed",
		prefetchRounds: false
	},
	blitz: {
		initialTimeMs: 6e4,
		description: "IDENTIFY AS MANY SONGS AS POSSIBLE IN 60 SECONDS",
		howToPlay: ["Identify as many songs as you can before the 60-second timer runs out. You get one guess per song. Guess right, get it wrong, or skip, and the next song starts immediately."],
		gameplay: "timed",
		clockDisplay: "countdown",
		failurePolicy: "replace",
		prefetchRounds: true
	},
	seek: {
		initialTimeMs: null,
		description: "FIND WHERE EACH CLIP BELONGS IN THE SONG",
		howToPlay: ["Listen to an 8-second clip and place it where you think it appears in the full song. After each guess, the clip's actual position is revealed.", "Play 5 rounds and earn up to 1,000 points per round. The closer your placement, the higher your score."],
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
		howToPlay: null,
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
function prefetchesRounds(mode) {
	return mode !== null && modeRules[mode].prefetchRounds;
}
function preservesFailedRound(mode, heard) {
	const policy = modeRules[mode].failurePolicy;
	return policy === "fixed" || policy === "heard-fixed" && heard;
}
function clockDisplayForMode(mode) {
	return modeRules[mode].clockDisplay;
}
function snippetSeconds(attempt) {
	return snippetDurations[Math.max(0, Math.min(puzzleAttemptCount - 1, attempt))];
}
function modeSnippetSeconds(mode, puzzleAttempt) {
	if (mode === null || isPuzzleMode(mode)) return snippetSeconds(puzzleAttempt);
	if (isPositionMode(mode)) return modeRules[mode].snippetSeconds;
	throw new Error(`Unsupported snippet-duration mode: ${String(mode)}`);
}
function actionLabel(mode, attempt) {
	if (mode === null) return "ADD 1S";
	if (isTimedMode(mode)) return "SKIP";
	if (isPuzzleMode(mode)) {
		if (attempt >= puzzleAttemptCount - 1) return "GIVE UP";
		return `ADD ${snippetDurations[attempt + 1] - snippetDurations[attempt]}S`;
	}
	throw new Error(`Unsupported action-label mode: ${String(mode)}`);
}
function seekPoints(guessedSecond, actualSecond, duration) {
	if (!Number.isFinite(duration) || duration <= 0) return 0;
	const relativeError = Math.min(1, Math.abs(guessedSecond - actualSecond) / duration);
	return Math.round(modeRules.seek.maxPointsPerRound * (1 - relativeError) ** 3);
}
function seekAttemptPoints(attempt) {
	return seekPoints(attempt.guessedSecond, attempt.actualSecond, attempt.trackDuration);
}
function seekGrade(points) {
	if (points === modeRules.seek.maxPointsPerRound) return "perfect";
	if (points >= 750) return "great";
	if (points >= 500) return "good";
	if (points >= 250) return "close";
	return "way-off";
}
function seekScore(attempts) {
	return attempts.reduce((total, attempt) => total + seekAttemptPoints(attempt), 0);
}
function accuracy(correct, guesses) {
	return guesses > 0 ? Math.round(correct * 100 / guesses) : 0;
}
function recordClassicResult(records, won, attempt) {
	const classic = records.classic;
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
			newPersonalBest: isBest,
			streak: classic.current,
			average
		};
	}
	const streak = classic.current;
	const average = classic.current ? classic.snippetTotal / classic.current : 0;
	classic.current = 0;
	classic.snippetTotal = 0;
	return {
		newPersonalBest: false,
		streak,
		average
	};
}
function updateBlitzBest(records, score, runAccuracy) {
	const current = records.blitz;
	const higherScore = score > current.score;
	const strongerTie = score > 0 && score === current.score && runAccuracy > (current.accuracy ?? -1);
	if (!higherScore && !strongerTie) return false;
	records.blitz = {
		score,
		accuracy: runAccuracy
	};
	return true;
}
function updateGauntletBest(records, won, elapsedMs, trackCount) {
	if (!won || trackCount <= 0) return false;
	const current = records.gauntlet;
	const largerCatalog = trackCount > current.trackCount;
	const fasterCurrentCatalog = trackCount === current.trackCount && (current.trackCount === 0 || elapsedMs < current.timeMs);
	if (!largerCatalog && !fasterCurrentCatalog) return false;
	records.gauntlet = {
		timeMs: elapsedMs,
		trackCount
	};
	return true;
}
function updateSeekBest(records, score) {
	if (score <= records.seek.score) return false;
	records.seek = { score };
	return true;
}
function gauntletCompleted(result) {
	return result.catalogTrackCount > 0 && result.completedTracks >= result.catalogTrackCount;
}
function puzzleCompleted(attempts) {
	return attempts[0]?.outcome === "correct" || attempts.length === puzzleAttemptCount;
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
function emptyPlayerRecords() {
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
function summarizeDiscovery(tracks, discoveries) {
	const discovered = tracks.reduce((total, track) => total + Number(discoveries.has(track.id)), 0);
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
	const trackIds = /* @__PURE__ */ new Set();
	const tracks = value.map((candidate, index) => {
		const fail = (reason) => {
			throw new Error(`Track catalog entry ${index + 1} ${reason}`);
		};
		if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) fail("is not an object.");
		const record = candidate;
		const title = typeof record.title === "string" ? record.title.trim() : "";
		const duration = record.duration;
		if (record.spotify !== void 0 && typeof record.spotify !== "string") fail("has an invalid Spotify track ID.");
		const spotify = typeof record.spotify === "string" ? record.spotify.trim() : "";
		if (record.isNew !== void 0 && typeof record.isNew !== "boolean") fail("has an invalid isNew flag.");
		const trackId = record.id;
		const releaseDate = record.releaseDate === null ? null : typeof record.releaseDate === "string" ? record.releaseDate.trim() : fail("has an invalid releaseDate.");
		if (!title) fail("has no title.");
		if (titles.has(title)) fail(`duplicates title "${title}".`);
		if (typeof duration !== "number" || !Number.isFinite(duration) || duration <= 0) fail("has an invalid duration.");
		if (!Number.isSafeInteger(trackId) || Number(trackId) <= 0) fail("has an invalid id.");
		if (trackIds.has(Number(trackId))) fail(`duplicates id ${String(trackId)}.`);
		if (spotify && !/^[A-Za-z0-9]{22}$/.test(spotify)) fail("has an invalid Spotify track ID.");
		if (releaseDate !== null && !isIsoDate(releaseDate)) fail("has an invalid releaseDate.");
		titles.add(title);
		trackIds.add(Number(trackId));
		return {
			title,
			duration: Number(duration),
			spotify,
			id: Number(trackId),
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
function selectDailyTrack(tracks, date, persistedTrackId) {
	const available = tracks.filter((track) => isReleasedBy(track, date));
	if (available.length === 0) return null;
	if (persistedTrackId !== null) {
		const persisted = available.find((track) => track.id === persistedTrackId);
		if (persisted) return persisted;
	}
	let selected = available[0];
	let selectedHash = stableHash(`corzaguessr-daily:${date}:${selected.id}`);
	for (const track of available.slice(1)) {
		const hash = stableHash(`corzaguessr-daily:${date}:${track.id}`);
		if (hash > selectedHash) {
			selected = track;
			selectedHash = hash;
		}
	}
	return selected;
}
function isDailyTrackAvailable(tracks, date, trackId) {
	return tracks.some((track) => track.id === trackId && isReleasedBy(track, date));
}
function maximumClipStart(track, clipSeconds) {
	const clip = Math.min(clipSeconds, track.duration);
	return Math.max(0, Math.floor(track.duration - clip));
}
function dailyClipStart(track, date) {
	const maximum = maximumClipStart(track, maxPuzzleSnippetSeconds);
	return stableHash(`corzaguessr-daily-clip:${date}:${track.id}`) % (maximum + 1);
}
function randomClipStart(track, clipSeconds, random = Math.random) {
	const maximum = maximumClipStart(track, clipSeconds);
	return Math.floor(clampRandom(random()) * (maximum + 1));
}
function selectRandomTrack(tracks, failed, previousTrackId, random = Math.random) {
	const playable = tracks.filter((track) => !failed.has(track.id));
	if (playable.length === 0) return null;
	const withoutPrevious = playable.length > 1 && previousTrackId !== null ? playable.filter((track) => track.id !== previousTrackId) : playable;
	const candidates = withoutPrevious.length ? withoutPrevious : playable;
	return candidates[Math.min(candidates.length - 1, Math.floor(clampRandom(random()) * candidates.length))] ?? null;
}
function clampRandom(value) {
	return Math.max(0, Math.min(.999999999999, value));
}
function isReleasedBy(track, date) {
	return track.releaseDate !== null && track.releaseDate <= date;
}
function validateCatalogManifest(value) {
	if (!value || typeof value !== "object" || !("assetRevision" in value) || !("tracks" in value) || typeof value.assetRevision !== "string" || !/^[0-9a-f]{40}$/.test(value.assetRevision)) throw new Error("Catalog requires an immutable assetRevision and tracks.");
	return {
		assetRevision: value.assetRevision,
		tracks: validateTrackCatalog(value.tracks)
	};
}
var puzzleAttemptCountV1 = 6;
var maxPuzzleSnippetSecondsV1 = 32;
var seekMaxScoreV1 = 5e3;
var saveKey = "corzaguessr:rewrite:save";
function defaults() {
	return {
		discoveries: /* @__PURE__ */ new Set(),
		daily: null,
		classic: null,
		records: emptyPlayerRecords(),
		volume: 100
	};
}
function record(v) {
	return !!v && typeof v === "object" && !Array.isArray(v);
}
function integer(v, min = 0, max = Number.MAX_SAFE_INTEGER) {
	return Number.isSafeInteger(v) && Number(v) >= min && Number(v) <= max;
}
function puzzleAttempts(v, allowCompleted, target) {
	if (!Array.isArray(v) || v.length > (allowCompleted ? puzzleAttemptCountV1 : puzzleAttemptCountV1 - 1)) return false;
	const guesses = /* @__PURE__ */ new Set();
	return v.every((attempt, index) => {
		if (!record(attempt)) return false;
		if (attempt.outcome === "skip") return attempt.trackId === null;
		if (!integer(attempt.trackId, 1) || guesses.has(attempt.trackId)) return false;
		guesses.add(attempt.trackId);
		return attempt.outcome === "wrong" ? attempt.trackId !== target : allowCompleted && index === 0 && attempt.outcome === "correct" && attempt.trackId === target;
	});
}
function parseRecords(value) {
	const result = emptyPlayerRecords();
	if (!record(value)) return {
		records: result,
		valid: false
	};
	let valid = true;
	const { classic: c, blitz: b, seek: s, gauntlet: g } = value;
	const total = (count, sum) => integer(sum, count, count * maxPuzzleSnippetSecondsV1);
	if (record(c) && integer(c.current) && integer(c.best, c.current) && total(c.current, c.snippetTotal) && total(c.best, c.bestSnippetTotal) && (c.best !== c.current || c.bestSnippetTotal <= c.snippetTotal)) result.classic = {
		current: c.current,
		best: c.best,
		snippetTotal: c.snippetTotal,
		bestSnippetTotal: c.bestSnippetTotal
	};
	else valid = false;
	if (record(b) && integer(b.score) && (b.score === 0 ? b.accuracy === null : integer(b.accuracy, 0, 100))) result.blitz = {
		score: b.score,
		accuracy: b.accuracy
	};
	else valid = false;
	if (record(s) && integer(s.score, 0, seekMaxScoreV1)) result.seek = { score: s.score };
	else valid = false;
	if (record(g) && integer(g.timeMs) && g.timeMs % 1e3 === 0 && integer(g.trackCount) && (g.trackCount > 0 || g.timeMs === 0)) result.gauntlet = {
		timeMs: g.timeMs,
		trackCount: g.trackCount
	};
	else valid = false;
	return {
		records: result,
		valid
	};
}
function parseSaveV1(value) {
	const result = defaults();
	let valid = true;
	if (Array.isArray(value.discoveries) && value.discoveries.every((id) => integer(id, 1))) result.discoveries = new Set(value.discoveries);
	else valid = false;
	const d = value.daily;
	if (d === null) result.daily = null;
	else if (record(d) && isIsoDate(d.date) && integer(d.trackId, 1) && puzzleAttempts(d.attempts, true, d.trackId)) result.daily = {
		date: d.date,
		trackId: d.trackId,
		attempts: d.attempts.map((a) => ({ ...a }))
	};
	else valid = false;
	const c = value.classic;
	if (c === null) result.classic = null;
	else if (record(c) && (c.kind === "standard" || c.kind === "preview") && typeof c.heard === "boolean" && integer(c.trackId, 1) && integer(c.clipStart) && puzzleAttempts(c.attempts, false, c.trackId)) if (c.heard || c.attempts.length === 0) result.classic = {
		kind: c.kind,
		trackId: c.trackId,
		clipStart: c.clipStart,
		heard: c.heard,
		attempts: c.attempts.map((a) => ({ ...a }))
	};
	else valid = false;
	else valid = false;
	const records = parseRecords(value.records);
	result.records = records.records;
	if (!records.valid) valid = false;
	if (integer(value.volume, 0, 100)) result.volume = value.volume;
	else valid = false;
	return {
		player: result,
		valid
	};
}
function savedAttempt(attempt) {
	return attempt.outcome === "skip" ? {
		outcome: "skip",
		trackId: null
	} : {
		outcome: attempt.outcome,
		trackId: attempt.trackId
	};
}
function serialize(data) {
	const attempts = (values) => values.map(savedAttempt);
	return {
		version: 1,
		discoveries: [...data.discoveries],
		daily: data.daily && {
			date: data.daily.date,
			trackId: data.daily.trackId,
			attempts: attempts(data.daily.attempts)
		},
		classic: data.classic && {
			kind: data.classic.kind,
			heard: data.classic.heard,
			trackId: data.classic.trackId,
			clipStart: data.classic.clipStart,
			attempts: attempts(data.classic.attempts)
		},
		records: {
			classic: { ...data.records.classic },
			blitz: { ...data.records.blitz },
			seek: { ...data.records.seek },
			gauntlet: { ...data.records.gauntlet }
		},
		volume: data.volume
	};
}
var SaveWriter = class {
	storage;
	canWrite;
	ownershipNotice;
	status = "ok";
	get notice() {
		if (this.status === "unsupported-version") return "THIS SAVE WAS CREATED BY A DIFFERENT VERSION. EXISTING PROGRESS IS PROTECTED; THIS TAB WILL NOT SAVE.";
		if (!this.canWrite()) return this.ownershipNotice() || "THIS TAB WILL NOT SAVE. RELOAD TO RETRY.";
		if (this.status === "read-failed") return "SAVED PROGRESS COULD NOT BE READ. THIS TAB WILL NOT SAVE. RELOAD TO RETRY.";
		if (this.status === "corrupt") return "SAVED PROGRESS WAS CORRUPTED. NEW PROGRESS WILL REPLACE IT.";
		return this.status === "write-failed" ? "PROGRESS COULD NOT BE SAVED. KEEP THIS TAB OPEN; SAVING WILL BE RETRIED WHEN PROGRESS CHANGES." : "";
	}
	constructor(storage = browserStorage(), canWrite = () => true, ownershipNotice = () => "") {
		this.storage = storage;
		this.canWrite = canWrite;
		this.ownershipNotice = ownershipNotice;
	}
	get unsupportedVersion() {
		return this.status === "unsupported-version";
	}
	load() {
		let raw;
		try {
			if (!this.storage) throw new Error("Storage unavailable");
			raw = this.storage.getItem(saveKey);
		} catch {
			this.status = "read-failed";
			return defaults();
		}
		if (raw === null) {
			this.status = "ok";
			return defaults();
		}
		try {
			const value = JSON.parse(raw);
			if (record(value) && "version" in value && value.version !== 1) {
				this.status = "unsupported-version";
				return defaults();
			}
			if (!record(value) || value.version !== 1) {
				this.status = "corrupt";
				return defaults();
			}
			const parsed = parseSaveV1(value);
			this.status = parsed.valid ? "ok" : "corrupt";
			return parsed.player;
		} catch {
			this.status = "corrupt";
			return defaults();
		}
	}
	write(data) {
		if (this.status === "unsupported-version" || this.status === "read-failed" || !this.canWrite() || !this.storage) return false;
		try {
			this.storage.setItem(saveKey, JSON.stringify(serialize(data)));
			this.status = "ok";
			return true;
		} catch {
			this.status = "write-failed";
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
var otherTab = "ANOTHER TAB IS SAVING YOUR PROGRESS. THIS TAB WILL NOT SAVE. CLOSE THE OTHER TAB AND RELOAD TO SAVE HERE.";
var unavailable = "SAVING IS UNAVAILABLE IN THIS BROWSER CONTEXT. YOU CAN PLAY, BUT PROGRESS WILL NOT BE SAVED.";
var released = "THIS TAB STOPPED SAVING. RELOAD TO ENABLE SAVING AGAIN.";
function ownershipNotice(status) {
	switch (status) {
		case "writable": return "";
		case "other-tab": return otherTab;
		case "unavailable": return unavailable;
		case "released": return released;
	}
}
function claimSaveOwnership(manager) {
	let status = "unavailable", releaseLock = null;
	const ownership = {
		get writable() {
			return status === "writable";
		},
		get notice() {
			return ownershipNotice(status);
		},
		release() {
			if (status === "released") return;
			status = "released";
			const release = releaseLock;
			releaseLock = null;
			release?.();
		}
	};
	if (!manager) return Promise.resolve(ownership);
	return new Promise((resolve) => {
		let resolved = false;
		const finish = () => {
			if (!resolved) {
				resolved = true;
				resolve(ownership);
			}
		};
		try {
			manager.request(`${saveKey}:owner`, { ifAvailable: true }, (lock) => {
				if (!lock) {
					status = "other-tab";
					finish();
					return;
				}
				status = "writable";
				const held = new Promise((release) => {
					releaseLock = release;
				});
				finish();
				return held;
			}).catch(() => {
				if (status !== "writable") status = "unavailable";
				finish();
			});
		} catch {
			status = "unavailable";
			finish();
		}
	});
}
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
			ready: false
		}));
	}
	setVolume(volume) {
		this.volume = Math.min(1, Math.max(0, Number.isFinite(volume) ? volume : 1));
		for (const slot of this.slots) slot.element.volume = this.volume;
	}
	loadPrimary(round) {
		this.loadRound(round, "primary");
	}
	loadPreload(round) {
		this.loadRound(round, "preload");
	}
	promotePreload(round) {
		const slot = this.preloadSlot;
		if (!slot || slot.round?.id !== round.id) throw new Error("Promoted round does not own the preload slot.");
		if (slot.failed) throw new Error("The preload role cannot own a failed slot.");
		if (slot.element.error) {
			this.preloadSlot = null;
			slot.failed = true;
			this.releaseSlot(slot);
			return false;
		}
		this.cancelPlaybackWatchdog();
		const previous = this.primarySlot;
		this.primarySlot = slot;
		this.preloadSlot = null;
		this.operation = null;
		if (previous && previous !== slot) {
			this.lastPrimarySlotId = previous.id;
			this.releaseSlot(previous);
		}
		return true;
	}
	playPrimary(round, restart) {
		const slot = this.primarySlot;
		if (!slot || slot.round?.id !== round.id) throw new Error("Played round does not own the primary slot.");
		if (this.suspension) throw new Error("Suspended audio cannot start playback.");
		if (slot.failed) return false;
		const operation = {
			id: ++this.nextOperationId,
			phase: "starting"
		};
		this.operation = operation;
		if (restart) {
			slot.element.pause();
			this.seek(slot);
		} else this.ensureStartPosition(slot);
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
		if (!slot || slot.round?.id !== round.id) throw new Error("Rewound round does not own the primary slot.");
		if (slot.failed || this.suspension || !this.operation || !this.isCurrentPlaybackOperation(slot, this.operation)) throw new Error("Rewind requires active primary playback.");
		this.cancelPlaybackWatchdog();
		this.operation = null;
		slot.element.pause();
		this.seek(slot, true);
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
	releasePreload() {
		this.discardPreload();
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
			preloadFailure: null
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
		if (suspension.preloadFailure) onFailure(suspension.preloadFailure);
		if (suspension.primaryFailure) onFailure(suspension.primaryFailure);
		if (this.primarySlot?.ready && !this.primarySlot.failed && this.primarySlot.round) this.callbacks.onPrimaryReady?.(this.primarySlot.round);
	}
	primaryStatus(round) {
		if (this.primarySlot?.round?.id !== round.id) return null;
		return {
			ready: this.primarySlot.ready,
			playRequested: Boolean(this.primarySlot && this.operation && this.isCurrentPlaybackOperation(this.primarySlot, this.operation))
		};
	}
	loadRound(round, channel) {
		if (channel === "primary") {
			this.cancelPlaybackWatchdog();
			this.operation = null;
		}
		const protectedSlot = channel === "primary" ? this.preloadSlot : this.primarySlot;
		const existing = channel === "primary" ? this.primarySlot : this.preloadSlot;
		if (existing?.round?.id === round.id && !existing.failed) throw new Error(`A healthy ${channel} round cannot be assigned twice.`);
		if (existing) {
			if (channel === "primary") this.primarySlot = null;
			else this.preloadSlot = null;
			this.releaseSlot(existing);
		}
		const candidates = this.slots.filter((slot) => slot !== protectedSlot);
		const slot = candidates.find((candidate) => candidate.id !== this.lastPrimarySlotId) ?? candidates[0] ?? null;
		if (!slot) throw new Error(`No audio slot is available for ${channel} playback.`);
		if (slot.round) throw new Error("An unassigned audio slot cannot own a round.");
		slot.round = round;
		slot.generation = ++this.generation;
		slot.failed = false;
		slot.ready = false;
		if (channel === "primary") this.primarySlot = slot;
		else this.preloadSlot = slot;
		this.bindSlotEvents(slot);
		slot.element.preload = "auto";
		slot.element.src = this.sourceForRound(round);
		slot.element.load();
		if (slot.element.error) {
			this.fail(slot, channel === "primary" ? "primary-load" : "preload-load");
			return;
		}
		if (slot.element.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA) this.markReady(slot);
	}
	bindSlotEvents(slot) {
		const controller = new AbortController();
		const generation = slot.generation;
		const round = slot.round;
		slot.controller = controller;
		if (!round) throw new Error("A bound audio slot requires a round.");
		const live = () => this.isCurrentSlot(slot, generation, round.id);
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
			if (live() && slot.element.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA) {
				this.markReady(slot);
				this.confirmPlaying(slot);
			}
		}, { signal: controller.signal });
		slot.element.addEventListener("playing", () => {
			if (!live() || slot !== this.primarySlot || this.suspension) return;
			if (!this.operation || !this.isCurrentPlaybackOperation(slot, this.operation)) return;
			this.markReady(slot);
			this.confirmPlaying(slot, true);
		}, { signal: controller.signal });
		slot.element.addEventListener("timeupdate", () => {
			if (!live() || slot !== this.primarySlot || !this.operation || this.suspension) return;
			this.confirmPlaying(slot);
		}, { signal: controller.signal });
		slot.element.addEventListener("pause", () => {
			if (!live() || slot !== this.primarySlot || this.suspension || !this.operation || !slot.element.paused || slot.element.ended) return;
			this.cancelPlaybackWatchdog();
			this.operation = null;
			this.callbacks.onInterrupted?.(round);
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
		slot.element.addEventListener("stalled", () => {
			if (slot.element.readyState < HTMLMediaElement.HAVE_FUTURE_DATA && !slot.element.paused) wait();
		}, { signal: controller.signal });
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
			const currentChannel = slot === this.preloadSlot ? "preload" : "primary";
			const activelyRequested = this.operation !== null && this.isCurrentPlaybackOperation(slot, this.operation);
			const stage = currentChannel === "preload" ? "preload-load" : activelyRequested ? "primary-play" : "primary-load";
			this.fail(slot, stage);
		}, { signal: controller.signal });
	}
	confirmPlaying(slot, playingEvent = false) {
		if (slot !== this.primarySlot || !slot.round || !this.operation || this.suspension || slot.element.paused) return;
		if (playingEvent && this.operation.phase === "starting") this.operation = {
			...this.operation,
			phase: "positioning"
		};
		this.ensureStartPosition(slot);
		if (this.operation.phase === "starting") return;
		if (slot.element.seeking || slot.element.readyState < HTMLMediaElement.HAVE_FUTURE_DATA || slot.element.currentTime + .35 < this.targetTime(slot)) return;
		if (this.operation.phase === "playing") return;
		this.cancelPlaybackWatchdog();
		this.operation = {
			...this.operation,
			phase: "playing"
		};
		this.callbacks.onPlaying(slot.round);
	}
	markReady(slot) {
		if (slot.ready || slot.failed || !slot.round) return;
		slot.ready = true;
		this.seek(slot);
		if (!this.suspension && slot === this.primarySlot) this.callbacks.onPrimaryReady?.(slot.round);
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
		if (failure.stage === "preload-load") this.suspension.preloadFailure = failure;
		else this.suspension.primaryFailure = failure;
	}
	startPlaybackWatchdog(slot, operation) {
		this.cancelPlaybackWatchdog();
		this.watchdogTimer = this.timing.setTimeout(() => {
			if (!this.isCurrentPlaybackOperation(slot, operation) || !this.operation || ![
				"starting",
				"positioning",
				"buffering"
			].includes(this.operation.phase)) return;
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
	ensureStartPosition(slot) {
		if (!slot.round || slot.element.readyState < HTMLMediaElement.HAVE_METADATA) return;
		if (slot.element.currentTime + .35 < this.targetTime(slot)) this.seek(slot);
	}
	isCurrentSlot(slot, generation, roundId) {
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
	}
};
function isNamedError(error, name) {
	return typeof error === "object" && error !== null && "name" in error && error.name === name;
}
function samePlaybackOperation(left, right) {
	return left?.id === right.id;
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
	currentDate;
	get date() {
		return this.currentDate;
	}
	get countdownMs() {
		return this.countdownTick && this.nextBoundaryAt ? Math.max(0, this.nextBoundaryAt - this.runtime.now()) : 0;
	}
	constructor(onDateChanged, runtime = browserRuntime) {
		this.onDateChanged = onDateChanged;
		this.runtime = runtime;
		this.currentDate = dailyDate(new Date(this.runtime.now()));
	}
	start() {
		this.currentDate = dailyDate(new Date(this.runtime.now()));
		this.scheduleNextBoundary();
	}
	startCountdown(onTick) {
		if (!this.nextBoundaryAt) throw new Error("Daily countdown requires a scheduled boundary.");
		this.countdownTick = onTick;
		this.emitCountdown();
	}
	stopCountdown() {
		this.countdownTick = null;
		if (this.countdownTimer) this.runtime.clearTimeout(this.countdownTimer);
		this.countdownTimer = 0;
	}
	reconcile() {
		const date = dailyDate(new Date(this.runtime.now()));
		const changed = date !== this.currentDate;
		this.currentDate = date;
		if (this.nextBoundaryAt) {
			this.scheduleNextBoundary();
			if (this.countdownTick) this.emitCountdown();
		}
		if (changed) this.onDateChanged(date);
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
		this.countdownTick();
		if (!remainingMs) return;
		const untilNextSecond = remainingMs % 1e3 || 1e3;
		this.countdownTimer = this.runtime.setTimeout(() => this.emitCountdown(), untilNextSecond);
	}
};
function browserServices(elements, audioUrl, catalog) {
	return {
		createClock: (callbacks) => new GameClock(callbacks),
		createCalendar: (onDay) => new DailySchedule(onDay),
		createAudio: (callbacks) => new AudioPlayer(elements, audioUrl, callbacks),
		catalog,
		timers: {
			setTimeout: (callback, delay) => window.setTimeout(callback, delay),
			clearTimeout: (handle) => window.clearTimeout(handle)
		}
	};
}
function emptyRounds(previousTrackId = null) {
	return {
		current: null,
		next: null,
		failedTrackIds: /* @__PURE__ */ new Set(),
		previousTrackId,
		consecutiveFailures: 0,
		exhausted: false
	};
}
function currentAttempts(state) {
	switch (state.run.mode) {
		case "daily": return state.player.daily?.date === state.run.date ? state.player.daily.attempts : [];
		case "classic": return state.run.finished?.challenge.attempts ?? state.player.classic?.attempts ?? [];
		case "blitz":
		case "gauntlet": return state.run.attempts;
		case "seek":
		case null: return [];
	}
}
function isRunFinished(state) {
	const run = state.run;
	return run.mode === null ? false : run.mode === "daily" ? run.finished : run.finished !== null;
}
function correctTrackIds(attempts) {
	return new Set(attempts.flatMap((a) => a.outcome === "correct" ? [a.trackId] : []));
}
function createRun(mode, date, state) {
	switch (mode) {
		case "daily": return {
			mode,
			date,
			finished: false
		};
		case "classic": return {
			mode,
			resumePending: state.player.classic?.heard === true,
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
	const catalog = state.catalog;
	const saved = state.player.daily;
	if (saved?.date === state.run.date && !puzzleCompleted(saved.attempts)) return !isDailyTrackAvailable(catalog, state.run.date, saved.trackId);
	return !selectDailyTrack(catalog, state.run.date, null);
}
function currentSnippetSeconds(state) {
	return modeSnippetSeconds(state.run.mode, Math.min(puzzleAttemptCount - 1, currentAttempts(state).length));
}
function initialClockMs(mode) {
	return modeRules[mode].initialTimeMs ?? modeSnippetSeconds(mode, 0) * 1e3;
}
function isClassicRoundValid(state) {
	const saved = state.player.classic;
	const track = state.catalog.find((t) => t.id === saved?.trackId);
	return !!saved && !!track && saved.clipStart <= maximumClipStart(track, maxPuzzleSnippetSeconds);
}
function classicRoundKind(track, date) {
	return isReleasedBy(track, date) ? "standard" : "preview";
}
function chooseRound(state, roundId, avoid, random) {
	const { run, catalog, player, rounds } = state;
	if (run.mode === null) return null;
	if (run.mode === "daily") {
		if (dailyUnavailable(state)) return null;
		const saved = player.daily?.date === run.date ? player.daily : null;
		const track = selectDailyTrack(catalog, run.date, saved?.trackId ?? null);
		return track ? {
			id: roundId,
			track,
			clipStart: dailyClipStart(track, run.date)
		} : null;
	}
	if (run.mode === "classic" && player.classic) {
		const track = catalog.find((t) => t.id === player.classic.trackId);
		return track ? {
			id: roundId,
			track,
			clipStart: player.classic.clipStart
		} : null;
	}
	const excluded = new Set(rounds.failedTrackIds);
	if (run.mode === "seek") for (const answer of run.answers) excluded.add(answer.trackId);
	const track = selectRandomTrack(catalog, excluded, avoid, random);
	const seconds = run.mode === "seek" ? modeRules.seek.snippetSeconds : run.mode === "classic" ? maxPuzzleSnippetSeconds : 60;
	return track ? {
		id: roundId,
		track,
		clipStart: randomClipStart(track, seconds, random)
	} : null;
}
function completeRun(state, elapsedMs) {
	const run = state.run;
	const records = state.player.records;
	switch (run.mode) {
		case null: throw new Error("Completion requires an active game mode");
		case "daily": {
			const challenge = state.player.daily;
			if (!challenge || challenge.date !== run.date || !puzzleCompleted(challenge.attempts)) throw new Error("Daily completion requires a completed current challenge");
			run.finished = true;
			return;
		}
		case "classic": {
			const challenge = state.player.classic;
			if (!challenge || !puzzleCompleted(challenge.attempts)) throw new Error("Classic completion requires a completed challenge");
			const result = challenge.kind === "preview" ? {
				newPersonalBest: false,
				streak: records.classic.current,
				average: records.classic.current ? records.classic.snippetTotal / records.classic.current : 0
			} : recordClassicResult(records, challenge.attempts[0]?.outcome === "correct", challenge.attempts.length - 1);
			state.run = {
				mode: "classic",
				resumePending: false,
				finished: {
					challenge: {
						kind: challenge.kind,
						trackId: challenge.trackId,
						attempts: challenge.attempts
					},
					newPersonalBest: result.newPersonalBest,
					streak: result.streak,
					average: result.average
				}
			};
			state.player.classic = null;
			return;
		}
		case "blitz": {
			if (!run.engaged) throw new Error("Blitz completion requires an engaged run");
			const correct = run.attempts.filter((a) => a.outcome === "correct").length;
			run.finished = { newPersonalBest: updateBlitzBest(records, correct, accuracy(correct, run.attempts.length)) };
			return;
		}
		case "gauntlet": {
			if (!run.engaged) throw new Error("Gauntlet completion requires an engaged run");
			const time = Math.floor(elapsedMs / 1e3) * 1e3;
			run.finished = {
				elapsedMs: time,
				newPersonalBest: updateGauntletBest(records, gauntletCompleted({
					completedTracks: correctTrackIds(run.attempts).size,
					catalogTrackCount: state.catalog.length
				}), time, state.catalog.length)
			};
			return;
		}
		case "seek":
			if (!run.engaged || run.phase.kind !== "revealed" || run.answers.length !== modeRules.seek.roundCount) throw new Error("Seek completion requires every round to be revealed");
			state.run = {
				mode: "seek",
				engaged: true,
				answers: run.answers,
				phase: { kind: "revealed" },
				finished: { newPersonalBest: updateSeekBest(records, seekScore(run.answers)) }
			};
			return;
	}
}
function availableActions(state, trackLoading) {
	const { run, rounds, player } = state;
	const ready = state.catalog.length > 0 && run.mode !== null && state.overlay.kind === "none" && !trackLoading;
	const complete = isRunFinished(state);
	const roundRetry = rounds.current?.phase === "retry";
	const technicallyBlocked = roundRetry || rounds.exhausted;
	const heard = rounds.current?.phase === "heard";
	const interact = ready && heard && !technicallyBlocked && !complete;
	const selecting = run.mode !== "seek" || run.phase.kind === "selecting";
	const guess = interact && run.mode !== "seek";
	const dailyLocked = run.mode === "daily" && (dailyCompleted(player.daily, run.date) || dailyUnavailable(state));
	return {
		play: ready && !complete && !dailyLocked && selecting,
		guess,
		action: run.mode === "classic" && (run.resumePending || roundRetry) ? ready : run.mode === "seek" ? ready && !complete && (run.phase.kind === "revealed" || interact && run.phase.kind === "selecting" && run.phase.second !== null) : guess,
		position: run.mode === "seek" && interact && selecting
	};
}
function buildClockViewModel(input) {
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
var uiText = {
	modePrompt: "SELECT A MODE TO BEGIN",
	loadingCatalog: "LOADING TRACKLIST...",
	catalogError: "COULD NOT LOAD THE TRACKLIST.",
	loadingTrack: "LOADING TRACK...",
	trackError: "COULD NOT PLAY TRACK, PRESS PLAY TO CONTINUE!",
	trackPoolExhausted: "NO PLAYABLE TRACKS REMAIN. PRESS PLAY TO RESTART THE RUN.",
	selectedTrackRetry: "THE SELECTED TRACK COULD NOT BE PLAYED. PRESS PLAY TO RETRY.",
	selectedTrackReplace: "THE SELECTED TRACK COULD NOT BE PLAYED. PRESS PLAY TO TRY ANOTHER.",
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
var shareUrl = "https://itsstolenvalor.com/corzaguessr";
function formatResultShare(date, result) {
	switch (result.mode) {
		case "daily": return formatDailyShare(date, result);
		case "classic": {
			const message = result.kind === "preview" ? "I encountered an upcoming song!" : result.won ? `I'm on a ${result.streak}-song streak!` : result.streak > 0 ? `My ${result.streak}-song streak ended.` : "No streak this time!";
			return shareCard("CLASSIC", puzzleBlocks(result.won, result.attempts), message);
		}
		case "blitz": return shareCard("BLITZ", `I correctly guessed ${result.correct} ${result.correct === 1 ? "song" : "songs"} in a minute!`);
		case "seek": return shareCard("SEEK", result.roundPoints.map(seekBlock).join(" "), `I scored ${result.score.toLocaleString("en-US")} out of ${seekMaxScore.toLocaleString("en-US")}!`);
		case "gauntlet": {
			const survived = gauntletCompleted(result);
			return shareCard("GAUNTLET", `${survived ? "🛡️" : "☠️"} ${formatClock(result.elapsedMs / 1e3)}`, survived ? "I survived the Gauntlet!" : "I failed the Gauntlet.");
		}
	}
}
function formatDailyShare(date, result) {
	const attempts = Math.max(1, Math.min(puzzleAttemptCount, Math.trunc(result.attempts)));
	const squares = puzzleBlocks(result.won, attempts);
	const outcome = result.won ? `I got it in ${attempts} ${attempts === 1 ? "try" : "tries"}!` : `I didn't get it in ${puzzleAttemptCount} tries!`;
	return shareCard(`DAILY // ${formatShareDate(date)}`, squares, outcome);
}
function puzzleBlocks(won, attempts) {
	const resolvedAttempts = Math.max(1, Math.min(puzzleAttemptCount, Math.trunc(attempts)));
	return Array.from({ length: puzzleAttemptCount }, (_, index) => won && index === resolvedAttempts - 1 ? "🟪" : "⬛").join(" ");
}
function seekBlock(points) {
	switch (seekGrade(points)) {
		case "perfect":
		case "great": return "🟩";
		case "good": return "🟨";
		case "close": return "🟧";
		case "way-off": return "🟥";
	}
}
function shareCard(heading, ...lines) {
	return `CORZAGUESSR✦ ${heading}\n\n${lines.join("\n")}\n\n${shareUrl}`;
}
function puzzleAnswer(previous, answer) {
	const attempts = [answer, ...previous];
	return {
		attempts,
		complete: puzzleCompleted(attempts),
		snippetMs: snippetSeconds(attempts.length) * 1e3
	};
}
function blitzAnswer(previous, answer) {
	return [answer, ...previous];
}
function gauntletAnswer(previous, answer, catalogCount) {
	const attempts = [answer, ...previous];
	return {
		attempts,
		complete: gauntletCompleted({
			completedTracks: new Set(attempts.filter((a) => a.outcome === "correct").map((a) => a.trackId)).size,
			catalogTrackCount: catalogCount
		}),
		adjustmentMs: modeRules.gauntlet.timeAdjustmentsMs[answer.outcome]
	};
}
function selectedSecond(second, round) {
	return Math.max(0, Math.min(maximumClipStart(round.track, modeRules.seek.snippetSeconds), Math.round(second)));
}
function seekAnswer(round, second) {
	return {
		trackId: round.track.id,
		trackDuration: round.track.duration,
		guessedSecond: selectedSecond(second, round),
		actualSecond: Math.round(round.clipStart)
	};
}
function buildResultViewModel(result, persistenceFailed, attempts = []) {
	if (!result) return null;
	const outcome = resultOutcome(result, attempts);
	const modules = resultModules(result);
	const announcement = announceResult(outcome, modules);
	return {
		mode: result.mode,
		outcome,
		primaryLabel: "CLOSE",
		modules,
		announcement: persistenceFailed ? `${announcement} PROGRESS COULD NOT BE SAVED IN THIS BROWSER.` : announcement,
		secondary: {
			label: "SHARE",
			ariaLabel: `SHARE ${result.mode.toUpperCase()} RESULT`
		}
	};
}
function resultModules(result) {
	if (result.mode === "daily") return [trackModule(result.trackTitle), runModule("TODAY'S SCORE", [formatAttempts(result.attempts), "ATTEMPTS"])];
	if (result.mode === "classic") {
		const run = result.kind === "preview" ? [
			String(result.streak),
			"STREAK UNCHANGED",
			`AVERAGE SNIPPET ${formatAverage(result.average)}`
		] : [String(result.streak), `AVERAGE SNIPPET ${formatAverage(result.average)}`];
		return [trackModule(result.trackTitle), runModule(result.kind === "preview" ? "PREVIEW ROUND" : result.won ? "CURRENT STREAK" : "STREAK ENDED", run, result.newPersonalBest)];
	}
	if (result.mode === "blitz") return [runModule("RUN SCORE", [
		String(result.correct),
		"CORRECT GUESSES",
		`${formatAccuracy(result.accuracy)} SUCCESS RATE`
	], result.newPersonalBest)];
	if (result.mode === "seek") return [runModule("RUN SCORE", [formatSeekScore(result.score), `/ ${seekMaxScore.toLocaleString("en-US")} POINTS`], result.newPersonalBest)];
	if (result.mode === "gauntlet") return [runModule("RUN TIME", [formatClock(result.elapsedMs / 1e3), `${result.completedTracks} / ${result.catalogTrackCount} TRACKS`], result.newPersonalBest)];
	throw new Error(`Unsupported result mode: ${String(result.mode)}`);
}
function announceResult(outcome, modules) {
	return `${outcome}. ${modules.map((module) => `${module.label}. ${resultModuleValue(module)}`).join(". ")}`.trim();
}
function resultOutcome(result, attempts) {
	if (result.mode === "daily" || result.mode === "classic") return puzzleResultMessage(result, attempts);
	if (result.mode === "blitz") return "TIME IS UP";
	if (result.mode === "seek") return "RUN COMPLETE";
	if (result.mode === "gauntlet") return gauntletCompleted(result) ? "YOU SURVIVED" : "TIME IS UP";
	throw new Error(`Unsupported result mode: ${String(result.mode)}`);
}
function puzzleResultMessage(result, attempts) {
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
function boardResetViewModel(state) {
	const mode = state.run.mode;
	if (mode === null) throw new Error("Board reset requires an active game mode");
	const positionMode = isPositionMode(mode);
	const snippetSeconds = positionMode ? modeRules[mode].snippetSeconds : snippetDurations[0];
	const initialMs = initialClockMs(mode);
	return {
		clock: buildClockViewModel({
			mode,
			snippetSeconds: isTimedMode(mode) ? null : snippetSeconds,
			clock: {
				elapsedMs: 0,
				remainingMs: initialMs,
				maxRemainingMs: initialMs,
				running: false
			}
		}),
		snippetSeconds,
		resetPosition: positionMode
	};
}
function buildResult(state) {
	const { run } = state;
	const catalog = state.catalog;
	if (!isRunFinished(state)) return null;
	const attempts = currentAttempts(state);
	switch (run.mode) {
		case "daily": {
			const progress = state.player.daily;
			const track = progress?.date === run.date ? catalog.find((candidate) => candidate.id === progress.trackId) : null;
			if (!track) throw new Error("A completed Daily requires its catalog track");
			return {
				mode: "daily",
				won: attempts[0]?.outcome === "correct",
				trackTitle: track.title,
				attempts: attempts.length
			};
		}
		case "classic": {
			if (!run.finished) throw new Error("A completed Classic requires completion context");
			const track = catalog.find((candidate) => candidate.id === run.finished.challenge.trackId);
			if (!track) throw new Error("A completed Classic requires its catalog track");
			return {
				mode: "classic",
				kind: run.finished.challenge.kind,
				won: attempts[0]?.outcome === "correct",
				trackTitle: track.title,
				attempts: attempts.length,
				newPersonalBest: run.finished.newPersonalBest,
				streak: run.finished.streak,
				average: run.finished.average
			};
		}
		case "blitz": {
			if (!run.finished) throw new Error("A completed Blitz requires completion context");
			const correct = attempts.filter((a) => a.outcome === "correct").length;
			return {
				mode: "blitz",
				correct,
				accuracy: accuracy(correct, attempts.length),
				newPersonalBest: run.finished.newPersonalBest
			};
		}
		case "gauntlet":
			if (!run.finished) throw new Error("A completed Gauntlet requires completion context");
			return {
				mode: "gauntlet",
				completedTracks: correctTrackIds(attempts).size,
				catalogTrackCount: catalog.length,
				elapsedMs: run.finished.elapsedMs,
				newPersonalBest: run.finished.newPersonalBest
			};
		case "seek": {
			if (!run.finished) throw new Error("A completed Seek requires completion context");
			const roundPoints = [...run.answers].reverse().map(seekAttemptPoints);
			return {
				mode: "seek",
				newPersonalBest: run.finished.newPersonalBest,
				score: roundPoints.reduce((total, points) => total + points, 0),
				roundPoints
			};
		}
		case null: throw new Error("A completed result requires an active game mode");
	}
}
function buildViewModel(state, context) {
	const { run, player, rounds } = state;
	const catalog = state.catalog;
	const mode = run.mode;
	const resolvedSeekAnswer = run.mode === "seek" && run.phase.kind !== "selecting" ? run.answers[0] : null;
	if (run.mode === "seek" && run.phase.kind !== "selecting" && !resolvedSeekAnswer) throw new Error("A resolved Seek phase requires its current answer");
	const seekPosition = resolvedSeekAnswer ? {
		selectedSecond: resolvedSeekAnswer.guessedSecond,
		actualSecond: resolvedSeekAnswer.actualSecond
	} : {
		selectedSecond: run.mode === "seek" && run.phase.kind === "selecting" ? run.phase.second : null,
		actualSecond: null
	};
	const round = rounds.current?.phase !== "unheard" || context.playbackRequested ? rounds.current?.round ?? null : null;
	const roundRetry = rounds.current?.phase === "retry";
	const technicallyBlocked = roundRetry || rounds.exhausted;
	const attempts = currentAttempts(state);
	const completed = isRunFinished(state);
	const date = run.mode === "daily" ? run.date : context.date;
	const dailyComplete = mode === "daily" && dailyCompleted(player.daily, date);
	const attempt = Math.min(puzzleAttemptCount - 1, completed || dailyComplete ? Math.max(0, attempts.length - 1) : attempts.length);
	const overlay = state.overlay.kind === "none" ? null : state.overlay.kind;
	const appStatus = state.catalog.length ? mode ? "ready" : "awaiting-mode" : state.catalogNotice === "error" ? "error" : "loading";
	const unavailable = mode === "daily" && dailyUnavailable(state);
	const actions = availableActions(state, context.trackLoading);
	const inputVisible = mode !== "seek" && !!round && !completed && !technicallyBlocked;
	const resume = run.mode === "classic" && run.resumePending;
	const preview = run.mode === "classic" && (run.finished?.challenge.kind ?? player.classic?.kind) === "preview";
	const forfeit = run.mode === "classic" && (resume || roundRetry);
	const duration = isTimedMode(mode) ? null : mode === "seek" ? modeRules.seek.snippetSeconds : snippetSeconds(attempt);
	const result = buildResult(state);
	let rulesText = mode ? modeRules[mode].description : uiText.modePrompt;
	if (appStatus === "error") rulesText = uiText.catalogError;
	else if (dailyComplete) {
		const remaining = Math.max(0, Math.ceil(context.countdownMs / 1e3));
		const count = [
			Math.floor(remaining / 3600),
			Math.floor(remaining / 60) % 60,
			remaining % 60
		].map((n) => String(n).padStart(2, "0")).join(":");
		rulesText = `${dailyWon(player.daily, date) ? "COMPLETED" : "FAILED"} IN ${attempts.length} ATTEMPT${attempts.length === 1 ? "" : "S"}, COME BACK IN ${count}`;
	} else if (appStatus === "loading") rulesText = state.catalogNotice === "loading" ? uiText.loadingCatalog : uiText.modePrompt;
	else if (rounds.exhausted) rulesText = uiText.trackPoolExhausted;
	else if (roundRetry) rulesText = uiText.trackError;
	else if (resume) rulesText = preview ? "PREVIEW ROUND · PRESS PLAY TO CONTINUE OR GIVE UP · STREAK SAFE" : "PRESS PLAY TO CONTINUE OR GIVE UP THE CURRENT ROUND";
	else if (preview) rulesText = "PREVIEW ROUND · STREAK SAFE";
	else if (run.mode === "seek") {
		if (run.phase.kind === "revealed" && resolvedSeekAnswer) rulesText = seekFeedback(resolvedSeekAnswer).join(" · ");
		else if (round) rulesText = "PLACE YOUR GUESS ON THE TIMELINE";
	} else if (mode === "daily") {
		if (unavailable) rulesText = uiText.trackUnavailable;
		else if (player.daily?.date === date) rulesText = `DAILY IN PROGRESS, CONTINUE FROM ATTEMPT ${attempts.length + 1}`;
	}
	const milestones = /* @__PURE__ */ new Set();
	const seen = /* @__PURE__ */ new Set();
	if (mode === "gauntlet") for (let i = attempts.length - 1; i >= 0; i--) {
		const a = attempts[i];
		if (a.outcome === "correct" && !seen.has(a.trackId)) {
			seen.add(a.trackId);
			milestones.add(attempts.length - i);
		}
	}
	let slots = run.mode === "seek" ? seekHistorySlots(run.answers, run.phase.kind, run.engaged) : mode === null ? [] : (isTimedMode(mode) ? attempts.slice(0, 19) : attempts).map((historyAttempt, index) => {
		const ordinal = attempts.length - index;
		return resolvedHistorySlot(mode, historyAttempt, ordinal, catalog, milestones.has(ordinal));
	});
	let promptSlot = null;
	if ((run.mode === "blitz" || run.mode === "gauntlet") && run.engaged) {
		const left = Math.max(0, catalog.length - seen.size);
		promptSlot = {
			id: attempts.length + 1,
			primary: completed ? mode === "gauntlet" && left === 0 ? "GAUNTLET COMPLETE" : "TIME'S UP" : mode === "gauntlet" ? `${left} ${left === 1 ? "TRACK" : "TRACKS"} LEFT` : `SONG ${attempts.length + 1}`,
			tone: completed ? "neutral" : "prompt"
		};
	} else if (isPuzzleMode(mode) && !completed && !dailyComplete && (round || attempts.length)) promptSlot = {
		id: attempt + 1,
		primary: `ATTEMPT ${attempt + 1}`,
		tone: attempt === puzzleAttemptCount - 1 ? "final-prompt" : "prompt"
	};
	if (technicallyBlocked && promptSlot) promptSlot = {
		id: promptSlot.id,
		primary: rounds.exhausted ? uiText.trackPoolExhausted : uiText.trackError,
		tone: "technical"
	};
	if (promptSlot) slots.unshift(promptSlot);
	const unavailableGuessIds = /* @__PURE__ */ new Set();
	if (isPuzzleMode(mode)) {
		for (const attempt of attempts) if (attempt.trackId !== null) unavailableGuessIds.add(attempt.trackId);
	} else if (mode === "gauntlet") for (const attempt of attempts) {
		if (attempt.outcome !== "wrong") break;
		unavailableGuessIds.add(attempt.trackId);
	}
	const seekAction = run.mode === "seek" && run.phase.kind === "revealed";
	return {
		saveNotice: context.saveNotice ?? "",
		appStatus,
		mode,
		rulesText,
		transportText: context.trackLoading ? uiText.loadingTrack : "",
		inputVisible,
		playEnabled: actions.play,
		attemptEnabled: actions.guess,
		actionEnabled: actions.action,
		playbackIcon: context.playbackRequested ? isTimedMode(mode) ? "pause" : "stop" : "play",
		snippetSeconds: duration,
		actionText: forfeit ? "GIVE UP" : run.mode === "seek" ? seekAction ? run.answers.length >= modeRules.seek.roundCount ? "RESULTS" : "NEXT" : "GUESS" : actionLabel(mode, attempt),
		slots,
		unavailableGuessIds,
		clock: buildClockViewModel({
			mode,
			snippetSeconds: duration,
			clock: context.clock
		}),
		positionTimeline: run.mode === "seek" && round ? {
			roundId: round.id,
			phase: run.phase.kind,
			maximumSecond: maximumClipStart(round.track, modeRules.seek.snippetSeconds),
			selectedSecond: seekPosition.selectedSecond,
			actualSecond: seekPosition.actualSecond,
			interactionEnabled: actions.position
		} : null,
		result: buildResultViewModel(result, !!context.saveNotice, attempts),
		dailyProgress: structuredClone(player.daily),
		playerRecords: structuredClone(player.records),
		dailyDate: date,
		discoveries: new Set(player.discoveries),
		tracks: catalog,
		overlay
	};
}
function resolvedHistorySlot(mode, attempt, ordinal, catalog, gauntletMilestone) {
	if (attempt.outcome !== "skip") return {
		id: ordinal,
		primary: catalog.find((track) => track.id === attempt.trackId)?.title ?? `TRACK #${attempt.trackId}`,
		tone: attempt.outcome,
		...gauntletMilestone ? { gauntletMilestone: true } : {}
	};
	if (mode === "daily" || mode === "classic") {
		const added = ordinal < puzzleAttemptCount ? snippetDurations[ordinal] - snippetDurations[ordinal - 1] : 0;
		return {
			id: ordinal,
			primary: `ATTEMPT ${ordinal} SKIPPED`,
			...added > 0 ? { detail: `${added} SECOND${added === 1 ? "" : "S"} ADDED` } : {},
			tone: "skip"
		};
	}
	if (mode === "blitz") return {
		id: ordinal,
		primary: `SONG ${ordinal} SKIPPED`,
		tone: "skip"
	};
	if (mode === "gauntlet") {
		const seconds = Math.abs(modeRules.gauntlet.timeAdjustmentsMs.skip) / 1e3;
		return {
			id: ordinal,
			primary: "SKIPPED",
			detail: `${seconds} SECOND${seconds === 1 ? "" : "S"} LOST`,
			tone: "skip"
		};
	}
	throw new Error("Seek answers do not use puzzle/timed attempt history");
}
function seekHistorySlots(answers, phase, engaged) {
	const resolvedAnswers = phase === "revealing" ? answers.slice(1) : answers;
	const latestResolvedRound = phase === "revealing" ? answers.length - 1 : answers.length;
	const slots = resolvedAnswers.map((answer, index) => {
		const round = latestResolvedRound - index;
		const points = seekAttemptPoints(answer);
		const grade = seekGradePresentation(seekGrade(points));
		return {
			id: round,
			primary: grade.label,
			detail: `${points.toLocaleString("en-US")} POINTS`,
			tone: grade.tone,
			ariaLabel: `Round ${round}, ${grade.accessibleLabel}, ${points.toLocaleString("en-US")} points`
		};
	});
	if (engaged && phase !== "revealed") {
		const round = answers.length + (phase === "selecting" ? 1 : 0);
		slots.unshift({
			id: round,
			primary: `ROUND ${round}`,
			tone: "prompt"
		});
	}
	return slots;
}
function seekGradePresentation(grade) {
	switch (grade) {
		case "perfect": return {
			label: "PERFECT",
			accessibleLabel: "Perfect",
			tone: "seek-perfect"
		};
		case "great": return {
			label: "GREAT",
			accessibleLabel: "Great",
			tone: "seek-great"
		};
		case "good": return {
			label: "GOOD",
			accessibleLabel: "Good",
			tone: "seek-good"
		};
		case "close": return {
			label: "CLOSE",
			accessibleLabel: "Close",
			tone: "seek-close"
		};
		case "way-off": return {
			label: "WAY OFF",
			accessibleLabel: "Way off",
			tone: "seek-way-off"
		};
	}
}
var Application = class {
	options;
	currentState;
	get state() {
		return structuredClone(this.currentState);
	}
	clock;
	audio;
	calendar;
	queue = [];
	processing = false;
	runId = 0;
	nextRoundId = 0;
	loadingNoticeTimer = 0;
	loadingNoticeGeneration = 0;
	trackLoading = false;
	pendingFocus = null;
	announcements = [];
	random;
	constructor(options) {
		this.options = options;
		this.random = options.random ?? Math.random;
		this.currentState = {
			player: structuredClone(options.player),
			catalog: [],
			catalogNotice: "none",
			run: { mode: null },
			rounds: emptyRounds(),
			overlay: { kind: "none" },
			visible: options.visible
		};
		this.calendar = options.services.createCalendar((date) => this.dispatch({
			type: "date-changed",
			date
		}));
		this.clock = options.services.createClock({
			onTick: (clock) => {
				if (!this.processing && this.currentState.run.mode !== "seek") options.view.renderClock(buildClockViewModel({
					mode: this.currentState.run.mode,
					snippetSeconds: isTimedMode(this.currentState.run.mode) ? null : currentSnippetSeconds(this.currentState),
					clock
				}));
			},
			onExpired: () => this.dispatch({ type: "expired" })
		});
		this.audio = options.services.createAudio({
			onPrimaryReady: (round) => this.dispatch({
				type: "primary-ready",
				round
			}),
			onPlaying: (round) => this.dispatch({
				type: "playing",
				round
			}),
			onWaiting: (round) => this.dispatch({
				type: "waiting",
				round
			}),
			onInterrupted: (round) => this.dispatch({
				type: "interrupted",
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
		this.audio.setVolume(this.currentState.player.volume / 100);
		options.view.bind({
			selectMode: (mode) => this.dispatch({
				type: "select-mode",
				mode
			}),
			play: () => this.dispatch({ type: "play" }),
			action: () => this.dispatch({ type: "action" }),
			guess: (trackId) => this.dispatch({
				type: "guess",
				trackId
			}),
			selectPositionSecond: (second) => this.dispatch({
				type: "select-position",
				second
			}),
			positionRevealComplete: (roundId) => this.dispatch({
				type: "seek-reveal-complete",
				roundId
			}),
			openDiscovery: () => this.dispatch({ type: "open-discovery" }),
			closeDiscovery: () => this.dispatch({ type: "close-discovery" }),
			openHelp: () => this.dispatch({ type: "open-help" }),
			closeHelp: () => this.dispatch({ type: "close-help" }),
			startGauntlet: () => this.dispatch({ type: "start-gauntlet" }),
			resultAction: () => this.dispatch({ type: "close-result" }),
			setVolume: (value, committed) => this.dispatch({
				type: "volume",
				value,
				committed
			}),
			openSpotify: (trackId) => this.dispatch({
				type: "open-spotify",
				trackId
			}),
			shareResult: () => this.dispatch({ type: "share-result" })
		});
	}
	start() {
		this.render();
		const source = this.options.services.catalog;
		let retryDelay = 5e3;
		const load = () => {
			const loadingNotice = this.options.services.timers.setTimeout(() => this.dispatch({
				type: "catalog-notice",
				notice: "loading"
			}), 2e3);
			const controller = new AbortController();
			let deadline = 0;
			const timeout = new Promise((_, reject) => {
				deadline = this.options.services.timers.setTimeout(() => {
					controller.abort();
					reject(/* @__PURE__ */ new Error("Catalog download timed out."));
				}, 15e3);
			});
			const clearAttempt = () => {
				this.options.services.timers.clearTimeout(loadingNotice);
				this.options.services.timers.clearTimeout(deadline);
			};
			Promise.race([source.load(controller.signal), timeout]).then((tracks) => {
				clearAttempt();
				this.dispatch({
					type: "catalog",
					tracks
				});
			}, (error) => {
				clearAttempt();
				this.dispatch({
					type: "catalog-notice",
					notice: "error"
				});
				if (!(error && typeof error === "object" && "retryable" in error && error.retryable === false)) {
					this.options.services.timers.setTimeout(load, retryDelay);
					retryDelay = Math.min(6e4, retryDelay * 2);
				}
			});
		};
		load();
	}
	dispatch(event) {
		this.queue.push(event);
		if (this.processing) return;
		this.processing = true;
		try {
			do {
				while (this.queue.length) this.handleEvent(this.queue.shift());
				this.render();
				if (this.queue.length) continue;
				const announcement = [...new Set(this.announcements)].join(" ");
				const focus = this.pendingFocus;
				this.announcements = [];
				this.pendingFocus = null;
				if (announcement) this.options.view.announce(announcement);
				if (focus) this.options.view[focus]();
			} while (this.queue.length);
		} finally {
			this.processing = false;
		}
	}
	handleEvent(event) {
		const state = this.currentState;
		const run = state.run;
		const current = state.rounds.current;
		switch (event.type) {
			case "catalog":
				if (state.catalog.length) return;
				state.catalog = event.tracks;
				state.catalogNotice = "none";
				this.validateRestore();
				this.prepareRound();
				if (state.overlay.kind === "none") this.pendingFocus = "focusAfterCatalogReady";
				return;
			case "catalog-notice":
				if (state.catalog.length) return;
				state.catalogNotice = event.notice;
				this.announce(event.notice === "error" ? uiText.catalogError : uiText.loadingCatalog);
				return;
			case "select-mode":
				if (state.overlay.kind !== "none" || run.mode === event.mode || state.catalogNotice === "error" && !state.catalog.length) return;
				this.reset(event.mode);
				this.announce(modeRules[event.mode].description);
				this.pendingFocus = "focusAfterModeSelected";
				return;
			case "play":
				this.play();
				return;
			case "guess": {
				if (!availableActions(state, this.trackLoading).guess || run.mode === "seek") return;
				if (isPuzzleMode(run.mode) && currentAttempts(state).some((a) => a.trackId === event.trackId)) return;
				const track = state.catalog.find((t) => t.id === event.trackId);
				if (track && current) this.resolveAttempt({
					outcome: track.id === current.round.track.id ? "correct" : "wrong",
					trackId: track.id
				});
				return;
			}
			case "action":
				if (run.mode === "classic" && current?.phase === "retry" && availableActions(state, this.trackLoading).action) {
					state.player.classic = null;
					this.save();
					this.reset("classic");
					this.announce("UNPLAYABLE CLASSIC ROUND REPLACED. YOUR STREAK WAS NOT AFFECTED.");
				} else if (run.mode === "classic" && run.resumePending && availableActions(state, this.trackLoading).action) {
					const preview = state.player.classic?.kind === "preview";
					state.player.classic = null;
					if (!preview) recordClassicResult(state.player.records, false, 0);
					this.save();
					this.reset("classic");
					this.announce(preview ? "PREVIOUS PREVIEW ROUND FORFEITED. YOUR STREAK WAS NOT AFFECTED." : "PREVIOUS CLASSIC ROUND FORFEITED.");
				} else if (run.mode === "seek") this.seekAction();
				else if (availableActions(state, this.trackLoading).action) this.resolveAttempt({
					outcome: "skip",
					trackId: null
				});
				return;
			case "select-position":
				if (run.mode === "seek" && run.phase.kind === "selecting" && current && availableActions(state, this.trackLoading).position && Number.isFinite(event.second)) run.phase.second = selectedSecond(event.second, current.round);
				return;
			case "seek-reveal-complete":
				if (run.mode === "seek" && run.phase.kind === "revealing" && current?.round.id === event.roundId) {
					const attempt = run.answers[0];
					if (!attempt) throw new Error("A revealing Seek round requires its resolved attempt");
					state.run = {
						...run,
						phase: { kind: "revealed" }
					};
					this.announce(`${seekFeedback(attempt).join(". ")}.`);
					this.pendingFocus = "focusAttemptAction";
				}
				return;
			case "primary-ready":
				if (!this.isInteractive()) return;
				if (current?.round.id === event.round.id) this.prefetchNextRound(current);
				return;
			case "playing":
				if (!this.isInteractive() || !current || current.round.id !== event.round.id || isRunFinished(state)) return;
				if (current.phase !== "unheard" && current.phase !== "heard") return;
				if (current.phase === "unheard") {
					current.phase = "heard";
					if (run.mode !== "daily") state.rounds.previousTrackId = current.round.track.id;
					if (run.mode !== null && !preservesFailedRound(run.mode, false)) state.rounds.failedTrackIds.clear();
					if (!isTimedMode(run.mode)) this.clock.restart(currentSnippetSeconds(state) * 1e3);
				}
				if (run.mode === "classic" && state.player.classic && !state.player.classic.heard) {
					state.player.classic = {
						...state.player.classic,
						heard: true
					};
					this.save();
				}
				state.rounds.consecutiveFailures = 0;
				this.clearTrackLoading();
				this.clock.start();
				this.prefetchNextRound(current);
				this.pendingFocus = "focusGuess";
				return;
			case "waiting":
				if (current?.round.id !== event.round.id || !this.isInteractive()) return;
				this.clock.pause();
				if (!this.loadingNoticeTimer && !this.trackLoading) this.scheduleLoadingNotice(current.round);
				return;
			case "interrupted":
				if (current?.round.id !== event.round.id) return;
				this.clearTrackLoading();
				this.clock.pause();
				this.announce("AUDIO PAUSED. PRESS PLAY TO CONTINUE.");
				return;
			case "blocked":
				if (current?.round.id !== event.round.id || !this.isInteractive()) return;
				this.clearTrackLoading();
				this.clock.pause();
				this.announce("PRESS PLAY TO START THE AUDIO.");
				this.pendingFocus = "focusPlay";
				return;
			case "ended":
				if (current?.phase !== "heard" || current.round.id !== event.round.id || !this.isInteractive() || isRunFinished(state)) return;
				this.clearTrackLoading();
				this.clock.pause();
				if (isTimedMode(run.mode)) this.resolveAttempt({
					outcome: "skip",
					trackId: null
				});
				return;
			case "failed":
				this.handleAudioFailure(event.failure, event.restored ?? false);
				return;
			case "loading-notice":
				if (event.generation === this.loadingNoticeGeneration && current?.round.id === event.roundId && this.isPlaybackRequested()) {
					this.loadingNoticeTimer = 0;
					this.trackLoading = true;
					this.announce(uiText.loadingTrack);
				}
				return;
			case "expired":
				if (isRunFinished(state) || !current || this.clock.snapshot().remainingMs > 0) return;
				if (isTimedMode(run.mode)) this.finishRun();
				else {
					this.audio.pause();
					this.clearTrackLoading();
				}
				return;
			case "open-discovery":
				this.calendar.reconcile();
				if (state.overlay.kind === "discovery") {
					this.closeDiscovery("resume");
					return;
				}
				if (state.overlay.kind !== "none") return;
				this.clock.pause();
				this.clearTrackLoading();
				this.audio.suspend();
				state.overlay = { kind: "discovery" };
				return;
			case "close-discovery":
				if (state.overlay.kind === "discovery") this.closeDiscovery("resume");
				return;
			case "open-help":
				if (state.overlay.kind !== "none") return;
				this.clock.pause();
				this.clearTrackLoading();
				this.audio.suspend();
				state.overlay = { kind: "help" };
				return;
			case "close-help":
				if (state.overlay.kind === "help") this.closeHelp();
				return;
			case "start-gauntlet":
				if (state.overlay.kind === "discovery" && summarizeDiscovery(state.catalog, state.player.discoveries).complete) this.closeDiscovery("start-gauntlet");
				return;
			case "close-result":
				if (state.overlay.kind === "result") this.closeResult();
				return;
			case "discovery-closed": {
				state.overlay = { kind: "none" };
				if (event.outcome === "start-gauntlet") {
					this.reset("gauntlet");
					this.announce(modeRules.gauntlet.description);
				} else if (state.visible) {
					this.restoreAudio();
					this.prepareRound();
				}
				const actions = availableActions(state, this.trackLoading);
				this.pendingFocus = actions.play ? "focusPlay" : actions.action ? "focusAttemptAction" : "focusProgress";
				return;
			}
			case "help-closed":
				state.overlay = { kind: "none" };
				if (state.visible) {
					this.restoreAudio();
					this.prepareRound();
				}
				this.pendingFocus = "focusHelp";
				return;
			case "result-closed": {
				state.overlay = { kind: "none" };
				let dailyRecap = false;
				if (event.outcome.kind === "daily-recap") {
					if (state.run.mode !== "daily") throw new Error("Daily recap requires a Daily run");
					state.run.finished = false;
					state.rounds = emptyRounds();
					if (state.run.date === this.calendar.date) {
						this.startCountdown();
						dailyRecap = true;
					} else this.reset("daily");
				} else this.reset(event.outcome.mode);
				this.pendingFocus = dailyRecap ? "focusAfterModeSelected" : state.run.mode ? "focusPlay" : "focusProgress";
				return;
			}
			case "hidden":
				state.visible = false;
				this.clock.pause();
				this.clearTrackLoading();
				this.audio.suspend();
				return;
			case "visible":
				state.visible = true;
				if (run.mode === "daily") {
					if (this.calendar.reconcile() !== run.date && !isRunFinished(state)) {
						this.reset("daily");
						return;
					}
				}
				if (state.overlay.kind === "none") {
					this.restoreAudio();
					this.prepareRound();
				}
				return;
			case "date-changed":
				if (run.mode === "daily" && run.date !== event.date && !isRunFinished(state)) this.reset("daily");
				return;
			case "countdown": return;
			case "volume":
				this.audio.setVolume(event.value / 100);
				if (event.committed && Number.isInteger(event.value) && event.value >= 0 && event.value <= 100) {
					state.player.volume = event.value;
					const persistenceAlreadyFailed = Boolean(this.options.storage.notice);
					if (!this.options.storage.write(state.player) && !persistenceAlreadyFailed) this.announce("VOLUME PREFERENCE COULD NOT BE SAVED IN THIS BROWSER.");
				}
				return;
			case "share-result": {
				const result = buildResult(state);
				if (!result || state.overlay.kind !== "result") return;
				const runId = this.runId;
				const date = run.mode === "daily" ? run.date : this.calendar.date;
				this.options.copyToClipboard(formatResultShare(date, result)).then((copied) => this.dispatch({
					type: "share-complete",
					runId,
					copied
				}), () => this.dispatch({
					type: "share-complete",
					runId,
					copied: false
				}));
				return;
			}
			case "share-complete":
				if (event.runId !== this.runId || state.overlay.kind !== "result" || !isRunFinished(state)) return;
				if (event.copied) this.options.view.showResultShareCopied();
				this.announce(event.copied ? "RESULT COPIED TO CLIPBOARD." : "RESULT COULD NOT BE COPIED IN THIS BROWSER.");
				return;
			case "open-spotify": {
				const spotify = state.overlay.kind === "discovery" && state.player.discoveries.has(event.trackId) ? state.catalog.find((t) => t.id === event.trackId)?.spotify : null;
				if (spotify) this.options.openSpotify(spotify);
				return;
			}
			default: return assertNever(event);
		}
	}
	reset(mode) {
		const state = this.currentState;
		const previous = state.run.mode === mode ? state.rounds.previousTrackId : null;
		this.clearTrackLoading();
		this.audio.stop();
		this.calendar.stop();
		this.runId++;
		state.rounds = emptyRounds(previous);
		if (mode === "daily") this.calendar.start();
		state.run = createRun(mode, this.calendar.date, state);
		this.validateRestore();
		this.clock.configure(initialClockMs(mode));
		if (mode === "daily" && this.isDailyComplete()) this.startCountdown();
		this.prepareRound();
	}
	validateRestore() {
		const state = this.currentState;
		if (state.run.mode === "classic" && state.catalog.length && state.player.classic && !isClassicRoundValid(state)) {
			state.player.classic = null;
			state.run.resumePending = false;
			this.save();
		}
	}
	prepareRound() {
		const state = this.currentState;
		if (!this.isInteractive() || !state.catalog.length || !state.run.mode || isRunFinished(state) || this.isDailyComplete() || state.rounds.current || state.rounds.exhausted) return;
		if (state.rounds.next) throw new Error("Priming a current round requires no preloaded successor");
		const round = this.chooseNextRound(state.rounds.previousTrackId);
		if (!round) {
			if (state.run.mode !== "daily") {
				state.rounds = {
					...state.rounds,
					current: null,
					next: null,
					exhausted: true
				};
				this.announce(uiText.trackPoolExhausted);
			}
			return;
		}
		state.rounds.current = {
			round,
			phase: "unheard"
		};
		this.pinClassicRound(round);
		this.audio.loadPrimary(round);
	}
	prefetchNextRound(current) {
		const state = this.currentState;
		if (state.rounds.next || !prefetchesRounds(state.run.mode)) return;
		const round = this.chooseNextRound(current.round.track.id);
		if (!round) return;
		state.rounds.next = round;
		this.audio.loadPreload(round);
	}
	restartExhaustedRun() {
		const state = this.currentState;
		if (!state.rounds.exhausted || state.run.mode === null) throw new Error("Exhausted recovery requires an exhausted active run");
		const mode = state.run.mode;
		this.reset(mode);
		this.startRound();
	}
	recoverRound(round) {
		const state = this.currentState;
		if (state.run.mode === null) throw new Error("Round retry requires an active game mode");
		state.rounds.consecutiveFailures = 0;
		const heard = state.run.mode === "classic" && state.player.classic?.heard === true;
		if (!preservesFailedRound(state.run.mode, heard)) {
			state.rounds.failedTrackIds.add(round.track.id);
			state.rounds.current = null;
			if (state.run.mode === "classic") {
				state.player.classic = null;
				state.run.resumePending = false;
				this.save();
			}
		} else {
			state.rounds.current = {
				round,
				phase: "unheard"
			};
			this.audio.loadPrimary(round);
		}
		this.startRound();
	}
	startRound() {
		const state = this.currentState;
		if (!this.isInteractive()) throw new Error("Round start requires an interactive application");
		let current = state.rounds.current;
		if (!current || current.phase === "heard") {
			if (current?.phase === "heard") state.rounds.current = null;
			if (state.rounds.next) {
				const round = state.rounds.next;
				state.rounds.next = null;
				state.rounds.current = {
					round,
					phase: "unheard"
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
				const round = this.chooseNextRound(state.rounds.previousTrackId);
				if (!round) {
					this.audio.releasePrimary();
					state.rounds = {
						...state.rounds,
						current: null,
						next: null,
						exhausted: true
					};
					this.announce(uiText.trackPoolExhausted);
					return;
				}
				state.rounds.current = {
					round,
					phase: "unheard"
				};
				this.pinClassicRound(round);
				this.audio.loadPrimary(round);
			}
			current = state.rounds.current;
		}
		if (!current || current.phase === "retry") throw new Error("Round start requires a playable current round");
		if (!this.audio.playPrimary(current.round, false)) return;
		if (state.run.mode === "blitz" || state.run.mode === "gauntlet" || state.run.mode === "seek") state.run.engaged = true;
		this.startDailyChallenge(current.round);
		this.clearTrackLoading();
		this.scheduleLoadingNotice(current.round);
		if (this.primaryStatus(current).ready) this.prefetchNextRound(current);
	}
	play() {
		const state = this.currentState;
		if (state.run.mode === "daily") {
			if (this.calendar.reconcile() !== state.run.date) {
				this.reset("daily");
				return;
			}
		}
		if (!availableActions(state, this.trackLoading).play || !this.isInteractive()) return;
		if (state.run.mode === "classic") state.run.resumePending = false;
		const current = state.rounds.current;
		if (!current || current.phase === "retry" || state.rounds.exhausted || current.phase === "unheard" && !this.isPlaybackRequested()) {
			if (state.rounds.exhausted) this.restartExhaustedRun();
			else if (current?.phase === "retry") this.recoverRound(current.round);
			else this.startRound();
			return;
		}
		const playbackRequested = this.isPlaybackRequested();
		this.clearTrackLoading();
		if (isTimedMode(state.run.mode)) {
			if (playbackRequested) {
				this.clock.pause();
				this.audio.pause();
			} else if (this.audio.playPrimary(current.round, false)) this.scheduleLoadingNotice(current.round);
		} else {
			const elapsed = this.clock.pause().elapsedMs;
			if (playbackRequested) this.audio.rewindPrimary(current.round);
			else if (this.audio.playPrimary(current.round, elapsed > 0)) this.scheduleLoadingNotice(current.round);
			this.clock.restart(currentSnippetSeconds(state) * 1e3);
			this.options.view.resetTimeline();
		}
		this.pendingFocus = "focusGuess";
	}
	startDailyChallenge(round) {
		const { run, player } = this.currentState;
		if (run.mode === "daily" && player.daily?.date !== run.date) {
			player.daily = {
				date: run.date,
				trackId: round.track.id,
				attempts: []
			};
			this.save();
		}
	}
	pinClassicRound(round) {
		const { run, player } = this.currentState;
		if (run.mode !== "classic" || player.classic) return;
		player.classic = {
			kind: classicRoundKind(round.track, this.calendar.reconcile()),
			trackId: round.track.id,
			clipStart: round.clipStart,
			attempts: [],
			heard: false
		};
		this.save();
	}
	resolveAttempt(attempt) {
		const state = this.currentState, run = state.run, current = state.rounds.current;
		if (!current || current.phase !== "heard" || isRunFinished(state) || !this.isInteractive()) throw new Error("Answer resolution requires an active heard round");
		if (!isPuzzleMode(run.mode) && !isTimedMode(run.mode)) throw new Error("Attempts require puzzle or timed gameplay");
		if (isTimedMode(run.mode)) {
			if ((run.mode === "gauntlet" && attempt.outcome === "wrong" ? this.clock.snapshot() : this.clock.pause()).remainingMs <= 0) {
				this.finishRun();
				return;
			}
		}
		this.options.view.resetGuessInput();
		const newlyDiscovered = attempt.outcome === "correct" && !state.player.discoveries.has(current.round.track.id);
		if (newlyDiscovered) state.player.discoveries.add(current.round.track.id);
		if (run.mode === "daily" || run.mode === "classic") {
			const challenge = run.mode === "daily" ? state.player.daily : state.player.classic;
			if (!challenge) throw new Error("Heard puzzle has no authoritative challenge");
			const running = this.isPlaybackRequested() && this.clock.snapshot().running;
			const resolution = puzzleAnswer(challenge.attempts, attempt);
			if (run.mode === "daily" && state.player.daily) state.player.daily = {
				...state.player.daily,
				attempts: resolution.attempts
			};
			else if (state.player.classic) state.player.classic = {
				...state.player.classic,
				attempts: resolution.attempts
			};
			if (resolution.complete) {
				this.finishRun();
				return;
			}
			this.announce(attempt.outcome === "wrong" ? "INCORRECT. TRY AGAIN." : "SKIPPED. MORE TIME ADDED.");
			const limit = resolution.snippetMs;
			if (running) this.clock.extendTo(limit);
			else {
				this.clearTrackLoading();
				if (this.audio.playPrimary(current.round, true)) this.scheduleLoadingNotice(current.round);
				this.options.view.resetTimeline();
				this.clock.restart(limit);
			}
			this.save();
			this.pendingFocus = "focusGuess";
			return;
		}
		if (run.mode !== "blitz" && run.mode !== "gauntlet") throw new Error("Timed attempts require Blitz or Gauntlet");
		if (run.mode === "gauntlet") {
			const resolution = gauntletAnswer(run.attempts, attempt, state.catalog.length);
			run.attempts = resolution.attempts;
			this.announce(resolution.complete ? "CORRECT. GAUNTLET COMPLETE." : attempt.outcome === "correct" ? "CORRECT." : attempt.outcome === "wrong" ? "INCORRECT. TRY AGAIN." : "SKIPPED.");
			if (attempt.outcome !== "wrong") {
				this.audio.pause();
				this.clearTrackLoading();
			}
			const delta = resolution.adjustmentMs;
			this.options.view.flashTimeChange(delta / 1e3);
			if (this.clock.adjust(delta).remainingMs <= 0) {
				this.finishRun();
				return;
			}
			if (resolution.complete) {
				this.finishRun();
				return;
			}
			if (newlyDiscovered) this.save();
			if (attempt.outcome === "wrong") {
				this.pendingFocus = "focusGuess";
				return;
			}
			this.startRound();
			return;
		}
		this.audio.pause();
		this.clearTrackLoading();
		run.attempts = blitzAnswer(run.attempts, attempt);
		this.announce(attempt.outcome === "correct" ? "CORRECT." : attempt.outcome === "wrong" ? "INCORRECT." : "SKIPPED.");
		if (newlyDiscovered) this.save();
		this.startRound();
	}
	seekAction() {
		const state = this.currentState, run = state.run, current = state.rounds.current;
		if (run.mode !== "seek" || !availableActions(state, this.trackLoading).action || !current) return;
		if (run.phase.kind === "revealed") if (run.answers.length >= modeRules.seek.roundCount) this.finishRun();
		else {
			state.run = {
				...run,
				phase: {
					kind: "selecting",
					second: null
				},
				finished: null
			};
			this.startRound();
		}
		else if (run.phase.kind === "selecting" && run.phase.second !== null) {
			this.clock.pause();
			this.audio.pause();
			this.clearTrackLoading();
			state.run = {
				...run,
				engaged: true,
				answers: [seekAnswer(current.round, run.phase.second), ...run.answers],
				phase: { kind: "revealing" },
				finished: null
			};
		}
	}
	finishRun() {
		if (isRunFinished(this.currentState)) throw new Error("Run completion requires an unfinished run");
		const time = this.clock.pause();
		this.clearTrackLoading();
		this.audio.stop();
		this.currentState.rounds.next = null;
		this.announcements = [];
		completeRun(this.currentState, time.elapsedMs);
		this.currentState.overlay = { kind: "result" };
		this.save();
	}
	handleAudioFailure(failure, restored) {
		const state = this.currentState;
		if (!this.isInteractive() || isRunFinished(state)) return;
		if (failure.stage === "preload-load") {
			if (state.rounds.next?.id !== failure.round.id) return;
			state.rounds.next = null;
			return;
		}
		const current = state.rounds.current;
		if (current?.round.id !== failure.round.id) return;
		if (state.run.mode === "seek" && state.run.phase.kind !== "selecting") return;
		const heard = current.phase === "heard" || state.run.mode === "classic" && state.player.classic?.heard === true;
		const preserve = state.run.mode !== null && preservesFailedRound(state.run.mode, heard);
		const play = failure.stage === "primary-play";
		this.clock.pause();
		this.clearTrackLoading();
		this.audio.releasePrimary();
		state.rounds.consecutiveFailures++;
		if (!preserve && !restored && state.rounds.consecutiveFailures <= 2) {
			state.rounds.failedTrackIds.add(failure.round.track.id);
			if (!play) {
				state.rounds.next = null;
				this.audio.releasePreload();
			}
			state.rounds.current = null;
			if (state.run.mode === "classic") {
				state.player.classic = null;
				state.run.resumePending = false;
				this.save();
			}
			if (state.run.mode === "seek") state.run.phase = {
				kind: "selecting",
				second: null
			};
			if (play) this.announce(uiText.selectedTrackReplacing);
			if (play) this.startRound();
			else this.prepareRound();
		} else {
			current.phase = "retry";
			if (state.run.mode === "classic") state.run.resumePending = false;
			this.announce(preserve ? uiText.selectedTrackRetry : uiText.selectedTrackReplace);
			this.pendingFocus = "focusPlay";
		}
	}
	closeResult() {
		const run = this.currentState.run;
		if (run.mode === null) throw new Error("A result close requires an active game mode");
		const dailyRecap = run.mode === "daily" && run.date === this.calendar.reconcile();
		const outcome = dailyRecap ? { kind: "daily-recap" } : {
			kind: "reset-mode",
			mode: run.mode
		};
		this.options.view.beginResultClose(dailyRecap ? void 0 : boardResetViewModel(this.currentState), () => this.dispatch({
			type: "result-closed",
			outcome
		}));
	}
	closeDiscovery(outcome) {
		this.options.view.beginDiscoveryClose(() => this.dispatch({
			type: "discovery-closed",
			outcome
		}));
	}
	closeHelp() {
		this.options.view.beginHelpClose(() => this.dispatch({ type: "help-closed" }));
	}
	restoreAudio() {
		this.audio.restore((failure) => this.dispatch({
			type: "failed",
			failure,
			restored: true
		}));
	}
	chooseNextRound(avoidTrackId) {
		return chooseRound(this.currentState, ++this.nextRoundId, avoidTrackId, this.random);
	}
	isDailyComplete() {
		return this.currentState.run.mode === "daily" && dailyCompleted(this.currentState.player.daily, this.currentState.run.date);
	}
	startCountdown() {
		this.calendar.startCountdown(() => this.dispatch({ type: "countdown" }));
	}
	isInteractive() {
		return this.currentState.visible && this.currentState.overlay.kind === "none";
	}
	isPlaybackRequested() {
		const current = this.currentState.rounds.current;
		return current && current.phase !== "retry" && !isRunFinished(this.currentState) ? this.primaryStatus(current).playRequested : false;
	}
	primaryStatus(current) {
		if (current.phase === "retry") throw new Error("A retry round does not own playable primary audio");
		const status = this.audio.primaryStatus(current.round);
		if (!status) throw new Error("A playable current round must own primary audio");
		return status;
	}
	clearTrackLoading() {
		this.options.services.timers.clearTimeout(this.loadingNoticeTimer);
		this.loadingNoticeTimer = 0;
		this.trackLoading = false;
		this.loadingNoticeGeneration++;
	}
	scheduleLoadingNotice(round) {
		const generation = this.loadingNoticeGeneration;
		this.loadingNoticeTimer = this.options.services.timers.setTimeout(() => this.dispatch({
			type: "loading-notice",
			roundId: round.id,
			generation
		}), 1e3);
	}
	save() {
		if (!this.options.storage.write(this.currentState.player) && this.currentState.overlay.kind !== "result") this.announce("PROGRESS COULD NOT BE SAVED IN THIS BROWSER.");
	}
	viewModel() {
		return buildViewModel(this.currentState, {
			clock: this.clock.snapshot(),
			playbackRequested: this.isPlaybackRequested(),
			trackLoading: this.trackLoading,
			saveNotice: this.options.storage.notice ?? "",
			date: this.calendar.date,
			countdownMs: this.calendar.countdownMs
		});
	}
	announce(message) {
		this.announcements.push(message);
	}
	render() {
		this.options.view.render(this.viewModel(), String(this.runId));
	}
};
function assertNever(value) {
	throw new Error(`Unsupported application event: ${JSON.stringify(value)}`);
}
function formatTrackId(trackId) {
	return String(trackId).padStart(2, "0");
}
function watchCssMotion(element, accepts, duration, scheduler, onFinished, subtree = false) {
	const animation = typeof element.getAnimations === "function" ? element.getAnimations({ subtree }).find(accepts) : void 0;
	let active = true;
	let timer = 0;
	const finish = () => {
		if (!active) return;
		active = false;
		onFinished();
	};
	if (animation) animation.finished.then(finish, () => {});
	else timer = scheduler.setTimer(finish, duration);
	return { cancel() {
		if (!active) return;
		active = false;
		if (animation) animation.cancel();
		if (timer) scheduler.clearTimer(timer);
	} };
}
function isCssAnimation(animation, name) {
	return "animationName" in animation && animation.animationName === name;
}
function isCssTransition(animation, property) {
	return "transitionProperty" in animation && animation.transitionProperty === property;
}
var AttemptHistoryView = class {
	elements;
	durations;
	reducedMotion;
	scheduler;
	renderedSlots = [];
	runId = "";
	nodeMotionGeneration = 0;
	fadeGenerations = /* @__PURE__ */ new WeakMap();
	collapseMotion = null;
	pendingSnapshot = null;
	wiggles = /* @__PURE__ */ new Map();
	constructor(elements, durations, reducedMotion, scheduler = browserAnimationScheduler) {
		this.elements = elements;
		this.durations = durations;
		this.reducedMotion = reducedMotion;
		this.scheduler = scheduler;
	}
	render(slots, runId) {
		const snapshot = {
			slots: [...slots],
			runId
		};
		if (this.pendingSnapshot) {
			this.pendingSnapshot = snapshot;
			return;
		}
		if (this.runId !== "" && runId !== this.runId && this.hasRenderedSlots()) {
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
			runId: this.runId
		};
		this.collapseSlots();
	}
	applySnapshot(snapshot, reveal = false) {
		this.runId = snapshot.runId;
		this.renderSlots(snapshot.slots, snapshot.runId);
		if (reveal) this.revealAttempts();
	}
	renderSlots(entries, runId) {
		const rendered = entries.map((entry) => ({
			key: `${runId}:${entry.id}`,
			primary: entry.primary,
			detail: entry.detail,
			tone: entry.tone,
			ariaLabel: entry.ariaLabel,
			gauntletMilestone: entry.gauntletMilestone === true
		}));
		if (rendered.length === this.renderedSlots.length && rendered.every((entry, index) => {
			const previous = this.renderedSlots[index];
			return previous?.key === entry.key && previous.primary === entry.primary && previous.detail === entry.detail && previous.tone === entry.tone && previous.ariaLabel === entry.ariaLabel && previous.gauntletMilestone === entry.gauntletMilestone;
		})) return;
		const previousSlots = this.renderedSlots;
		this.renderedSlots = rendered;
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
			const previousPrimary = previous?.primary ?? "";
			const previousDetail = previous?.detail;
			const previousAriaLabel = previous?.ariaLabel;
			const wasMilestone = previous?.gauntletMilestone ?? false;
			const changedHead = (isNew || previousPrimary !== entry.primary || previousDetail !== entry.detail || previousTone !== entry.tone || previousAriaLabel !== entry.ariaLabel || wasMilestone !== entry.gauntletMilestone) && previousSlots[0]?.key === entry.key;
			this.applyTone(element, previousTone, entry.tone);
			this.renderContent(element, entry);
			this.applyAccessibility(element, entry.gauntletMilestone, entry.ariaLabel, visibleText(entry));
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
		this.watchHeightTransition(container, duration, () => {
			container.style.height = "";
		});
	}
	startCollapse(container, fading, duration, onFinished) {
		this.cancelCollapse();
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
		this.watchHeightTransition(container, duration, onFinished);
	}
	watchHeightTransition(container, duration, onFinished) {
		const motion = watchCssMotion(container, (animation) => isCssTransition(animation, "height"), duration, this.scheduler, () => {
			if (this.collapseMotion !== motion) return;
			this.collapseMotion = null;
			onFinished();
		});
		this.collapseMotion = motion;
	}
	cancelCollapse(resetHeight = true) {
		if (resetHeight && this.collapseMotion) this.elements.container.style.height = "";
		this.collapseMotion?.cancel();
		this.collapseMotion = null;
	}
	clearRenderedSlots() {
		this.renderedSlots = [];
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
	renderContent(element, entry) {
		const primary = document.createElement("span");
		primary.className = "slot-primary";
		primary.textContent = entry.primary;
		if (!entry.detail) {
			element.replaceChildren(primary);
			return;
		}
		const separator = document.createElement("span");
		separator.className = "slot-separator";
		separator.textContent = " · ";
		const detail = document.createElement("span");
		detail.className = "slot-detail";
		detail.textContent = entry.detail;
		element.replaceChildren(primary, separator, detail);
	}
	applyAccessibility(element, gauntletMilestone, ariaLabel, text) {
		element.classList.toggle("gauntlet-milestone", gauntletMilestone);
		const label = gauntletMilestone ? `${ariaLabel ?? text}. Counts toward Gauntlet completion.` : ariaLabel;
		if (label) element.setAttribute("aria-label", label);
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
		const motion = watchCssMotion(element, (animation) => isCssAnimation(animation, "corzaguessr-wiggle"), this.durations.wiggle, this.scheduler, () => {
			if (this.wiggles.get(element) !== motion) return;
			this.wiggles.delete(element);
			element.classList.remove("wiggle");
		});
		this.wiggles.set(element, motion);
	}
	cancelWiggle(element) {
		this.wiggles.get(element)?.cancel();
		this.wiggles.delete(element);
		element.classList.remove("wiggle");
	}
};
function toneClasses(tone) {
	if (tone === "correct" || tone === "wrong" || tone === "skip") return [tone];
	if (tone === "final-prompt" || tone === "technical") return ["blink"];
	if (tone.startsWith("seek-")) return [tone];
	return [];
}
function visibleText(slot) {
	return slot.detail ? `${slot.primary} · ${slot.detail}` : slot.primary;
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
	return value.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().replace(/[’'‘`]/gu, "").replace(/&/gu, " and ").replace(/[^\p{L}\p{N}]+/gu, " ").trim().split(/\s+/u).filter(Boolean).map((word) => tokenAliases[word] ?? word).join(" ");
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
	return index.filter((entry) => !unavailable.has(entry.track.id)).map((entry) => ({
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
	if (prefixPositions !== null) return [3, prefixPositions];
	const partialPositions = tokenPositions(entry.tokens, queryTokens, (titleToken, queryToken) => titleToken.includes(queryToken));
	return partialPositions === null ? null : [4, partialPositions];
}
function tokenPositions(titleTokens, queryTokens, matches) {
	let positionTotal = 0;
	const used = /* @__PURE__ */ new Set();
	for (const queryToken of queryTokens) {
		const position = titleTokens.findIndex((titleToken, index) => !used.has(index) && matches(titleToken, queryToken));
		if (position < 0) return null;
		used.add(position);
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
			if (track) this.onGuess(track.id);
		});
	}
	setDependencies(tracks, unavailable, releaseDate = null) {
		const unavailableChanged = unavailable.size !== this.unavailable.size || [...unavailable].some((id) => !this.unavailable.has(id));
		const catalogChanged = tracks !== this.tracks || releaseDate !== this.releaseDate;
		if (!catalogChanged && !unavailableChanged) return;
		const selectedId = this.suggestions[this.selectedIndex]?.id ?? null;
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
		const preserved = selectedId === null ? -1 : this.suggestions.findIndex((track) => track.id === selectedId);
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
		if (track) this.onGuess(track.id);
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
		const ordered = [...tracks].sort((a, b) => b.id - a.id);
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
		this.items.replaceChildren(...ordered.map((track) => discoveries.has(track.id) ? this.createDiscoveredItem(track) : this.createUndiscoveredItem(track)));
	}
	createDiscoveredItem(track) {
		const item = document.createElement("div");
		item.className = "discovery-item discovery-item-known";
		item.dataset.trackId = String(track.id);
		item.setAttribute("role", "listitem");
		const coverUrl = this.coverUrl(track.id);
		item.style.setProperty("--discovery-artwork", `url(${JSON.stringify(coverUrl)})`);
		const detailsId = `corzaguessr-discovery-track-${track.id}`;
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
		toggle.addEventListener("click", () => this.toggle(track.id));
		item.append(toggle);
		if (track.spotify) {
			const spotify = document.createElement("button");
			spotify.type = "button";
			spotify.className = "button discovery-track-spotify";
			spotify.textContent = "SPOTIFY";
			spotify.setAttribute("aria-label", `OPEN ${track.title} ON SPOTIFY`);
			spotify.addEventListener("click", () => this.openSpotify?.(track.id));
			item.append(spotify);
		}
		this.applyExpandedState(item, track.id === this.expandedTrackId);
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
			const title = item.dataset.trackId ? this.tracks?.find((track) => String(track.id) === item.dataset.trackId)?.title : null;
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
	openFrame = 0;
	shellMotion = null;
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
		this.openModal("result");
		this.announce(announcement || "RESULT");
	}
	openDiscovery() {
		this.openModal("discovery");
	}
	openHelp() {
		this.openModal("help");
	}
	closeResult(onClosed = () => {}, onClosing = () => {}) {
		this.closeModal("result", onClosed, onClosing);
	}
	closeDiscovery(onClosed) {
		this.closeModal("discovery", onClosed);
	}
	closeHelp(onClosed) {
		this.closeModal("help", onClosed);
	}
	openModal(kind) {
		if (this.kind) throw new Error("Opening a modal requires no active modal.");
		const parts = this.getModalParts(kind);
		this.beginOpen();
		this.kind = kind;
		this.closing = false;
		this.lockScroll();
		parts.classTarget.classList.add(parts.openClass);
		parts.modal.setAttribute("aria-hidden", "false");
		if (kind === "discovery") this.elements.discoveryButton.setAttribute("aria-expanded", "true");
		else if (kind === "help") this.elements.helpButton.setAttribute("aria-expanded", "true");
		const finishOpen = () => {
			this.openFrame = 0;
			if (this.kind !== kind || this.closing) return;
			parts.classTarget.classList.add(parts.visibleClass);
			parts.shell.style.height = `${parts.panel.offsetHeight}px`;
			if (this.reducedMotion.matches && kind === "discovery") {
				parts.shell.offsetHeight;
				this.elements.discoveryClose.style.visibility = "visible";
			}
			parts.focusTarget.focus({ preventScroll: true });
			if (this.reducedMotion.matches) parts.shell.style.height = "auto";
			else {
				const motion = watchCssMotion(parts.shell, (animation) => isCssTransition(animation, "height"), this.duration, this.scheduler, () => {
					if (this.shellMotion !== motion || this.kind !== kind || this.closing) return;
					this.shellMotion = null;
					parts.shell.style.height = "auto";
				});
				this.shellMotion = motion;
			}
		};
		if (this.reducedMotion.matches) {
			parts.shell.style.transition = "none";
			finishOpen();
		} else {
			parts.shell.style.height = "0px";
			parts.shell.offsetHeight;
			this.openFrame = this.scheduler.requestFrame(finishOpen);
		}
	}
	closeModal(kind, onClosed, onClosing = () => {}) {
		if (this.closing || this.kind !== kind) return;
		const parts = this.getModalParts(kind);
		this.closing = true;
		onClosing();
		this.scheduler.cancelFrame(this.openFrame);
		this.openFrame = 0;
		const currentHeight = parts.shell.offsetHeight;
		this.cancelShellMotion();
		parts.classTarget.classList.remove(parts.visibleClass);
		parts.shell.style.height = `${currentHeight}px`;
		parts.shell.offsetHeight;
		parts.shell.style.height = "0px";
		if (kind === "discovery") this.elements.discoveryButton.setAttribute("aria-expanded", "false");
		else if (kind === "help") this.elements.helpButton.setAttribute("aria-expanded", "false");
		const finish = () => {
			if (this.kind !== kind || !this.closing) return;
			this.shellMotion = null;
			parts.classTarget.classList.remove(parts.openClass, parts.visibleClass);
			parts.shell.style.height = "";
			parts.shell.style.transition = "";
			if (kind === "discovery") this.elements.discoveryClose.style.visibility = "";
			this.kind = null;
			this.closing = false;
			this.unlockScroll();
			onClosed();
			parts.modal.setAttribute("aria-hidden", "true");
		};
		if (this.reducedMotion.matches) {
			queueMicrotask(finish);
			return;
		}
		this.shellMotion = watchCssMotion(parts.shell, (animation) => isCssTransition(animation, "height"), this.duration, this.scheduler, finish);
	}
	trapFocus(event) {
		if (event.key !== "Tab" || !this.kind) return;
		const focusable = [...this.getModalParts(this.kind).panel.querySelectorAll("button:not([disabled]), input:not([disabled])")].filter((element) => element.tabIndex >= 0 && !element.hidden && element.offsetParent !== null);
		if (!focusable.length) return;
		const first = focusable[0];
		const last = focusable.at(-1);
		if (!focusable.includes(document.activeElement)) {
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
	lockScroll() {
		if (this.lockedScroll) return;
		const html = document.documentElement;
		const body = document.body;
		const scrollbarWidth = Math.max(0, window.innerWidth - html.clientWidth);
		this.lockedScroll = {
			properties: [],
			scrollX: window.scrollX,
			scrollY: window.scrollY
		};
		const setLockedStyle = (element, name, value, priority = "") => {
			this.lockedScroll.properties.push({
				element,
				name,
				value: element.style.getPropertyValue(name),
				priority: element.style.getPropertyPriority(name)
			});
			element.style.setProperty(name, value, priority);
		};
		if (scrollbarWidth > 0) setLockedStyle(body, "padding-inline-end", `${(Number.parseFloat(getComputedStyle(body).paddingInlineEnd) || 0) + scrollbarWidth}px`);
		for (const element of [html, body]) {
			setLockedStyle(element, "overflow-x", "hidden", "important");
			setLockedStyle(element, "overflow-y", "hidden", "important");
		}
	}
	unlockScroll() {
		if (!this.lockedScroll) return;
		const snapshot = this.lockedScroll;
		for (const { element, name, value, priority } of snapshot.properties) if (value) element.style.setProperty(name, value, priority);
		else element.style.removeProperty(name);
		this.lockedScroll = null;
		if (window.scrollX !== snapshot.scrollX || window.scrollY !== snapshot.scrollY) window.scrollTo(snapshot.scrollX, snapshot.scrollY);
	}
	beginOpen() {
		this.cancelShellMotion();
		this.scheduler.cancelFrame(this.openFrame);
		this.openFrame = 0;
	}
	cancelShellMotion() {
		this.shellMotion?.cancel();
		this.shellMotion = null;
	}
	getModalParts(kind) {
		switch (kind) {
			case "result": return {
				classTarget: this.elements.card,
				openClass: "result-open",
				visibleClass: "result-visible",
				modal: this.elements.result,
				shell: this.elements.resultShell,
				panel: this.elements.resultPanel,
				focusTarget: this.elements.resultAction
			};
			case "discovery": return {
				classTarget: this.root,
				openClass: "discovery-open",
				visibleClass: "discovery-visible",
				modal: this.elements.discoveryModal,
				shell: this.elements.discoveryShell,
				panel: this.elements.discoveryPanel,
				focusTarget: this.elements.discoveryClose
			};
			case "help": return {
				classTarget: this.elements.card,
				openClass: "help-open",
				visibleClass: "help-visible",
				modal: this.elements.helpModal,
				shell: this.elements.helpShell,
				panel: this.elements.helpPanel,
				focusTarget: this.elements.helpClose
			};
		}
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
	render(records, daily, dailyDate) {
		const summaryRows = rows(records, daily, dailyDate);
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
function rows(records, daily, dailyDate) {
	const classicAverage = records.classic.best ? records.classic.bestSnippetTotal / records.classic.best : 0;
	const dailyComplete = dailyCompleted(daily, dailyDate);
	const standard = [
		{
			mode: "DAILY",
			value: dailyComplete ? dailyWon(daily, dailyDate) ? `${dailyAttempt(daily) + 1}/${puzzleAttemptCount}` : "FAILED" : emptyRecordValue,
			detail: dailyComplete ? formatOrdinalDate(dailyDate) : emptyRecordDetail
		},
		{
			mode: "CLASSIC",
			value: records.classic.best ? `${records.classic.best}-GAME STREAK` : emptyRecordValue,
			detail: records.classic.best ? `AVERAGE ${formatDecimal(classicAverage)}s` : emptyRecordDetail
		},
		{
			mode: "BLITZ",
			value: records.blitz.score ? `${records.blitz.score} CORRECT` : emptyRecordValue,
			detail: records.blitz.score ? `${records.blitz.accuracy ?? 0}% SUCCESS RATE` : emptyRecordDetail
		},
		{
			mode: "SEEK",
			value: records.seek.score ? `${records.seek.score} POINTS` : emptyRecordValue,
			detail: records.seek.score ? "BEST SCORE" : emptyRecordDetail
		}
	];
	if (records.gauntlet.trackCount > 0) standard.push({
		mode: "GAUNTLET",
		value: formatClock(records.gauntlet.timeMs / 1e3),
		detail: `${records.gauntlet.trackCount} ${records.gauntlet.trackCount === 1 ? "TRACK" : "TRACKS"}`
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
	scheduler;
	current = null;
	copyFeedbackTimer = 0;
	copyFeedbackFade = null;
	constructor(elements, durations, reducedMotion, scheduler = browserAnimationScheduler) {
		this.elements = elements;
		this.durations = durations;
		this.reducedMotion = reducedMotion;
		this.scheduler = scheduler;
	}
	render(result) {
		if (JSON.stringify(result) === JSON.stringify(this.current)) return;
		this.current = result;
		if (this.copyFeedbackTimer) {
			window.clearTimeout(this.copyFeedbackTimer);
			this.copyFeedbackTimer = 0;
		}
		this.copyFeedbackFade?.cancel();
		this.copyFeedbackFade = null;
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
		this.elements.secondaryLabel.textContent = result.secondary.label;
		this.elements.secondary.setAttribute("aria-label", result.secondary.ariaLabel);
		this.elements.secondary.hidden = false;
	}
	showShareCopied() {
		if (!this.current) return;
		if (this.copyFeedbackTimer) window.clearTimeout(this.copyFeedbackTimer);
		this.copyFeedbackFade?.cancel();
		this.copyFeedbackFade = null;
		this.elements.secondaryLabel.classList.remove("fading");
		this.elements.secondaryLabel.textContent = "COPIED";
		this.copyFeedbackTimer = window.setTimeout(() => {
			this.copyFeedbackTimer = 0;
			if (this.current) this.swapSecondaryLabel("SHARE");
		}, this.durations.shareVisible);
	}
	swapSecondaryLabel(text) {
		const label = this.elements.secondaryLabel;
		if (label.textContent === text || this.reducedMotion.matches) {
			label.textContent = text;
			return;
		}
		label.classList.remove("fading");
		label.offsetWidth;
		label.classList.add("fading");
		const motion = watchCssMotion(label, (animation) => isCssTransition(animation, "opacity"), this.durations.shareFade, this.scheduler, () => {
			if (this.copyFeedbackFade !== motion) return;
			this.copyFeedbackFade = null;
			label.textContent = text;
			label.classList.remove("fading");
		});
		this.copyFeedbackFade = motion;
	}
};
function createResultModule(result) {
	const module = document.createElement("div");
	module.className = `result-module result-${result.kind}`;
	const value = document.createElement("span");
	value.className = "result-value";
	value.setAttribute("aria-label", resultModuleValue(result));
	value.replaceChildren(...result.kind === "track" ? [resultLine("result-track-title", result.value)] : createMetricLines(result.lines));
	module.replaceChildren(createResultLabel(result.label, result.kind === "run" && result.newPersonalBest), value);
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
	timeAdjustmentMotion = null;
	positionFrame = 0;
	positionRevealKey = "";
	positionResetMotion = null;
	renderedPosition = null;
	pendingPosition = null;
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
		if (!state) {
			this.pendingPosition = null;
			this.cancelPositionReset();
			this.applyPosition(null, onRevealComplete);
			return;
		}
		if (this.elements.timeline.classList.contains("position-resetting") && !this.positionResetMotion) {
			this.cancelPositionReset();
			this.renderedPosition = null;
		}
		if (this.positionResetMotion) {
			this.pendingPosition = {
				state,
				onRevealComplete
			};
			return;
		}
		if (state.phase === "selecting" && this.renderedPosition?.phase === "revealed" && this.renderedPosition.roundId !== state.roundId) {
			this.pendingPosition = {
				state,
				onRevealComplete
			};
			this.beginPositionReset(() => {
				const pending = this.pendingPosition;
				this.pendingPosition = null;
				if (pending) this.applyPosition(pending.state, pending.onRevealComplete);
			});
			return;
		}
		this.pendingPosition = null;
		this.applyPosition(state, onRevealComplete);
	}
	applyPosition(state, onRevealComplete) {
		this.renderedPosition = state;
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
			this.cancelPositionReset();
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
			this.cancelPositionReset();
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
	beginPositionReset(onComplete) {
		this.cancelPositionReveal();
		this.elements.positionRange.disabled = true;
		if (this.elements.timeline.classList.contains("position-resetting")) return;
		this.elements.timeline.classList.add("position-resetting");
		if (!onComplete) return;
		const finish = () => {
			if (!this.elements.timeline.classList.contains("position-resetting")) return;
			this.positionResetMotion = null;
			this.elements.timeline.classList.remove("position-resetting");
			onComplete();
		};
		if (this.reducedMotion.matches || this.durations.reset <= 0) {
			queueMicrotask(finish);
			return;
		}
		this.positionResetMotion = watchCssMotion(this.elements.positionDistance, (animation) => isCssTransition(animation, "opacity"), this.durations.reset, this.scheduler, finish);
	}
	beginReset(rewindPlayback = false) {
		if (rewindPlayback && this.elements.timeline.classList.contains("progress-rewinding")) return;
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
		const finish = () => {
			if (this.timeAdjustmentMotion !== motion) return;
			this.timeAdjustmentMotion = null;
			this.clearTimeAdjustmentFeedback();
		};
		const motion = watchCssMotion(this.elements.timeChangeText, (animation) => isCssAnimation(animation, "corzaguessr-time-adjustment-hit"), this.durations.timeAdjustmentFeedback, this.scheduler, finish);
		this.timeAdjustmentMotion = motion;
	}
	clearTimeAdjustmentFeedback() {
		this.timeAdjustmentMotion?.cancel();
		this.timeAdjustmentMotion = null;
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
	cancelPositionReset() {
		this.positionResetMotion?.cancel();
		this.positionResetMotion = null;
		this.elements.timeline.classList.remove("position-resetting");
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
var helpModes = [
	"daily",
	"blitz",
	"classic",
	"seek"
];
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
	runId = null;
	inputModality;
	hoveredButton = null;
	preview = null;
	rulesSignature = "";
	announcementFrame = 0;
	constructor(root, initialVolume = 100, coverUrl = (id) => `covers/${formatTrackId(id)}.webp`) {
		this.root = root;
		this.inputModality = this.finePointer.matches ? "pointer-fine" : "pointer-coarse";
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
		this.autocomplete = new Autocomplete(this.elements.guess, this.elements.suggest, (id) => this.handlers?.guess(id), () => this.handlers?.play());
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
		if (this.handlers) throw new Error("GameView can only be bound once.");
		this.handlers = handlers;
		this.volume.bind(handlers.setVolume);
		this.discovery.bind(handlers.openSpotify, handlers.startGauntlet);
		this.elements.play.addEventListener("click", handlers.play);
		this.elements.action.addEventListener("click", handlers.action);
		this.elements.positionRange.addEventListener("input", () => {
			handlers.selectPositionSecond(Number(this.elements.positionRange.value));
		});
		this.elements.resultAction.addEventListener("click", handlers.resultAction);
		this.elements.resultSecondary.addEventListener("click", handlers.shareResult);
		this.elements.helpButton.addEventListener("click", handlers.openHelp);
		this.elements.helpClose.addEventListener("click", handlers.closeHelp);
		this.elements.helpModal.addEventListener("click", (event) => {
			if (!(event.target instanceof Element && event.target.closest(".help-panel"))) handlers.closeHelp();
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
		document.addEventListener("keydown", (event) => {
			if (!this.root.isConnected) return;
			if (this.state?.overlay || event.target instanceof Node && this.root.contains(event.target)) this.handleRootKeydown(event);
			else this.setInputModality("keyboard");
		}, true);
		this.root.addEventListener("pointermove", (event) => this.handlePointerMove(event));
		this.root.addEventListener("pointerdown", (event) => this.handlePointerDown(event));
		this.root.addEventListener("pointerleave", () => {
			this.hoveredButton = null;
		});
	}
	render(state, runId) {
		const notice = this.root.querySelector(".save-notice");
		if (state.saveNotice) {
			const message = notice ?? document.createElement("p");
			message.className = "save-notice glass";
			message.setAttribute("role", "status");
			if (message.textContent !== state.saveNotice) message.textContent = state.saveNotice;
			if (!notice) this.root.querySelector("h1").after(message);
		} else notice?.remove();
		if (this.modal.resultClosing) return;
		const previousOverlay = this.state?.overlay ?? null;
		const sessionChanged = this.runId !== null && this.runId !== runId;
		const openingOverlay = state.overlay !== previousOverlay ? state.overlay : null;
		this.state = state;
		this.runId = runId;
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
		this.elements.action.disabled = !state.actionEnabled;
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
			button.disabled = state.appStatus === "error" && !state.tracks.length || selected;
			button.setAttribute("aria-pressed", String(selected));
		}
		this.elements.icon.setAttribute("d", icons[state.playbackIcon]);
		this.elements.play.setAttribute("aria-label", state.playbackIcon === "play" ? "PLAY" : state.playbackIcon === "pause" ? "PAUSE" : "STOP");
		this.elements.action.textContent = state.actionText;
		if (state.snippetSeconds !== null) this.elements.snippet.style.width = snippetPercentage(state.snippetSeconds);
		this.renderRules();
		this.attempts.render(state.slots, runId);
		this.autocomplete.setDependencies(state.tracks, state.unavailableGuessIds, state.mode === "daily" ? state.dailyDate : null);
		if (state.overlay === "discovery") {
			this.renderDiscovery(state);
			this.progressSummary.render(state.playerRecords, state.dailyProgress, state.dailyDate);
		}
		if (state.result || !this.modal.resultLayoutActive) this.resultView.render(state.result);
		this.renderClock(state.clock);
		this.timeline.renderPosition(state.positionTimeline, (roundId) => this.handlers?.positionRevealComplete(roundId));
		if (openingOverlay === "result") this.modal.openResult(state.result?.announcement);
		else if (openingOverlay === "discovery") {
			this.discovery.collapseAll();
			this.modal.openDiscovery();
		} else if (openingOverlay === "help") this.modal.openHelp();
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
	beginResultClose(resetBoard, onClosed) {
		this.modal.closeResult(() => {
			this.resultView.render(null);
			onClosed?.();
		}, resetBoard ? () => this.beginBoardReset(resetBoard) : void 0);
	}
	beginDiscoveryClose(onClosed) {
		this.modal.closeDiscovery(() => onClosed?.());
	}
	beginHelpClose(onClosed) {
		this.modal.closeHelp(() => onClosed?.());
	}
	showResultShareCopied() {
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
	beginBoardReset(target) {
		this.timeline.beginReset();
		this.renderClock(target.clock);
		if (target.resetPosition) this.timeline.beginPositionReset();
		this.elements.snippet.style.width = snippetPercentage(target.snippetSeconds);
		this.attempts.beginReset();
	}
	focusPlay() {
		if (!this.elements.play.disabled && !this.elements.play.closest("[inert]")) this.elements.play.focus({ preventScroll: true });
	}
	focusProgress() {
		this.elements.discoveryButton.focus({ preventScroll: true });
	}
	focusHelp() {
		this.elements.helpButton.focus({ preventScroll: true });
	}
	focusAttemptAction() {
		if (!this.elements.action.disabled && !this.elements.action.closest("[inert]")) this.elements.action.focus({ preventScroll: true });
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
		const text = this.state.transportText || (!this.preview || this.preview === this.state.mode ? this.state.rulesText : this.preview === "discovery" ? uiText.progress : modeRules[this.preview].description);
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
				if (this.state.overlay === "discovery") this.handlers.closeDiscovery();
				else if (this.state.overlay === "help") this.handlers.closeHelp();
				else this.handlers.resultAction();
				return;
			}
			if (this.state.overlay === "result" && this.isArrowKey(event.key)) {
				event.preventDefault();
				this.moveResultFocus(event.key);
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
			this.handlers.play();
		}
	}
	isArrowKey(key) {
		return key === "ArrowUp" || key === "ArrowDown" || key === "ArrowLeft" || key === "ArrowRight";
	}
	moveResultFocus(key) {
		const candidates = [this.elements.resultAction, this.elements.resultSecondary];
		this.cycleFocus(candidates, key, candidates[0], null);
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
		return element.getClientRects().length > 0;
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
			action: this.required(".action"),
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
			helpButton: this.required(".help-button"),
			helpModal: this.required(".help-modal"),
			helpShell: this.required(".help-shell"),
			helpPanel: this.required(".help-panel"),
			helpClose: this.required(".help-close"),
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
	const modeButtons = regularModes.map((mode) => `<button type="button" class="mode" data-mode="${mode}" aria-pressed="false">${mode.toUpperCase()}</button>`).join("");
	const helpSections = helpModes.map((mode) => {
		const instructions = modeRules[mode].howToPlay;
		if (!instructions) throw new Error(`${mode} requires How to Play instructions`);
		const paragraphs = instructions.map((text) => `<p>${text}</p>`).join("");
		return `<section class="help-mode"><h4>${mode.toUpperCase()}</h4>${paragraphs}</section>`;
	}).join("");
	return [
		`<div class="wrap">`,
		`<h1>CORZAGUESSR&#10022;</h1>`,
		`<div class="row header-action"><button type="button" id="corzaguessr-progress" class="button discovery-button glass" aria-controls="corzaguessr-discovery" aria-expanded="false"><span>PROGRESS</span></button></div>
    <div class="game-surface"><div class="modes mode-navigation glass" aria-label="GAME MODE">${modeButtons}</div>`,
		`<div class="card glass">`,
		`<div class="stack">`,
		`<div class="board">`,
		`<div class="controls"><div class="time"><span class="now">0:00</span></div><button type="button" class="play" aria-label="PLAY" disabled><svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="${icons.play}"></path></svg></button><div class="time"><span class="endtime">0:01</span></div></div>`,
		`<button type="button" class="help-button" aria-label="HOW TO PLAY" aria-haspopup="dialog" aria-controls="corzaguessr-help" aria-expanded="false"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"></circle><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3"></path><path d="M12 17h.01"></path></svg></button>`,
		`<div class="volume-control"><div class="volume-bars" aria-hidden="true"><i class="volume-bar"></i><i class="volume-bar"></i><i class="volume-bar"></i><i class="volume-bar"></i><i class="volume-bar"></i><i class="volume-bar"></i><i class="volume-bar"></i><i class="volume-bar"></i></div><input class="volume-range" type="range" min="0" max="100" step="1" value="100" aria-label="VOLUME" aria-valuetext="100 percent"></div>`,
		`<div class="timeline"><div class="snippet" style="width:${snippetPercentage(snippetDurations[0])}"></div><div class="fill"></div><div class="feedback"></div><div class="position-distance" hidden></div><div class="position-marker position-guess" hidden></div><div class="position-marker position-actual" hidden></div><input class="position-range" type="range" min="0" max="0" step="1" value="0" aria-label="SELECT SONG POSITION" aria-valuetext="NO POSITION SELECTED" disabled><div class="time-change"><span></span></div>${snippetTicks}</div>`,
		`<div class="guess-lane"><div class="auto"><label class="sr-only" for="corzaguessr-guess">SEARCH FOR A TRACK</label><input id="corzaguessr-guess" class="guess" placeholder="HAVE A GUESS? SEARCH FOR IT HERE!" autocomplete="off" role="combobox" aria-autocomplete="list" aria-controls="corzaguessr-suggestions" aria-expanded="false" disabled><div class="ruleset" aria-hidden="true"><div class="ruleset-track"><span class="ruleset-text">${uiText.modePrompt}</span><span class="ruleset-copy">${uiText.modePrompt}</span></div></div><div id="corzaguessr-suggestions" class="suggest" role="listbox"></div></div><div class="row action-row"><button type="button" class="button action" disabled>ADD 1S</button></div></div>`,
		`</div>`,
		`<div class="attempt-area" aria-live="polite" aria-relevant="additions text"><div class="slots"></div></div>`,
		`</div>`,
		`<div class="result-modal" aria-hidden="true"><div class="result-shell"><div class="corzaguessr-modal glass" role="dialog" aria-modal="true" aria-labelledby="corzaguessr-result-title" aria-describedby="corzaguessr-result-meta" tabindex="-1"><h3 id="corzaguessr-result-title" class="modal-title"></h3><div id="corzaguessr-result-meta" class="result-meta"></div><div class="actions"><button type="button" class="button result-action">CLOSE</button><button type="button" class="button result-secondary" hidden></button></div></div></div></div>`,
		`<div id="corzaguessr-help" class="help-modal" aria-hidden="true"><div class="help-shell"><div class="help-panel corzaguessr-modal glass" role="dialog" aria-modal="true" aria-labelledby="corzaguessr-help-title"><h3 id="corzaguessr-help-title" class="help-title">HOW TO PLAY</h3><div class="help-content">${helpSections}</div><div class="actions"><button type="button" class="button help-close">CLOSE</button></div></div></div></div>`,
		`<div id="corzaguessr-discovery" class="discovery-modal" aria-hidden="true"><div class="discovery-shell"><div class="discovery-panel glass" role="dialog" aria-modal="true" aria-labelledby="corzaguessr-discovery-title"><div class="discovery-title"><span id="corzaguessr-discovery-title">DISCOVERY</span><small>0 / 0 (0%)</small></div><div class="discovery-items" role="list"></div><section class="progress-summary" aria-labelledby="corzaguessr-records-title"><h4 id="corzaguessr-records-title">RECORDS</h4><div class="progress-bests"></div></section><div class="actions"><button type="button" class="button discovery-close">CLOSE</button></div></div></div></div>`,
		`</div>`,
		`</div>`,
		`<p class="mode-prompt" role="status" aria-hidden="false">${uiText.modePrompt}</p>`,
		`</div>`,
		`<p class="sr-only status" aria-live="polite"></p>`,
		`<audio class="audio" preload="metadata" playsinline aria-hidden="true" hidden></audio>`,
		`<audio class="audio" preload="metadata" playsinline aria-hidden="true" hidden></audio>`
	].join("");
}
var CatalogLoadError = class extends Error {
	kind;
	status;
	get retryable() {
		return this.kind === "network" || this.kind === "http" && (this.status === 408 || this.status === 429 || this.status !== void 0 && this.status >= 500);
	}
	constructor(kind, message, options, status) {
		super(message, options);
		this.kind = kind;
		this.status = status;
		this.name = "CatalogLoadError";
	}
};
var CatalogSource = class {
	url;
	fetchCatalog;
	manifest = null;
	assetUrl(path) {
		if (!this.manifest) throw new Error("Catalog assets are not loaded.");
		return `https://cdn.jsdelivr.net/gh/HankeyThePoo/corzaguessr@${this.manifest.assetRevision}/${path}`;
	}
	constructor(url, fetchCatalog = (input, init) => fetch(input, init)) {
		this.url = url;
		this.fetchCatalog = fetchCatalog;
	}
	async load(signal) {
		if (this.manifest) return this.manifest.tracks;
		const url = new URL(this.url);
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
		if (!response.ok) throw new CatalogLoadError("http", `Track catalog returned ${response.status}.`, void 0, response.status);
		let text;
		try {
			text = await response.text();
		} catch (cause) {
			throw new CatalogLoadError("network", "Track catalog download was interrupted.", { cause });
		}
		signal?.throwIfAborted();
		let value;
		try {
			value = JSON.parse(text);
		} catch (cause) {
			throw new CatalogLoadError("invalid-json", "Track catalog is not valid JSON.", { cause });
		}
		try {
			const { tracks, assetRevision } = validateCatalogManifest(value);
			const frozenTracks = Object.freeze(tracks.map((track) => Object.freeze({ ...track })));
			this.manifest = Object.freeze({
				assetRevision,
				tracks: frozenTracks
			});
			return frozenTracks;
		} catch (cause) {
			throw new CatalogLoadError("invalid-catalog", cause instanceof Error ? cause.message : "Track catalog is invalid.", { cause });
		}
	}
};
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
if (root) initialize(root);
async function initialize(root) {
	let ownership = null;
	let application = null;
	let pageLeft = false;
	window.addEventListener("pagehide", () => {
		pageLeft = true;
		ownership?.release();
	});
	window.addEventListener("pageshow", (event) => {
		if (event.persisted) {
			window.location.reload();
			return;
		}
		if (!document.hidden) application?.dispatch({ type: "visible" });
	});
	ownership = await claimSaveOwnership(navigator.locks);
	if (pageLeft) {
		ownership.release();
		return;
	}
	const storage = new SaveWriter(void 0, () => ownership.writable, () => ownership.notice);
	const player = storage.load();
	const moduleUrl = new URL(import.meta.url);
	const catalogUrl = new URL("tracks.json", moduleUrl);
	catalogUrl.search = moduleUrl.search;
	const catalog = new CatalogSource(catalogUrl);
	const view = new GameView(root, player.volume, (id) => catalog.assetUrl(`covers/${formatTrackId(id)}.webp`));
	if (storage.unsupportedVersion) ownership.release();
	application = new Application({
		view,
		storage,
		player,
		visible: !document.hidden,
		copyToClipboard,
		openSpotify,
		services: browserServices(view.audioElements, (round) => catalog.assetUrl(`tracks/${formatTrackId(round.track.id)}.mp3`), catalog)
	});
	application.start();
	document.addEventListener("visibilitychange", () => application?.dispatch({ type: document.hidden ? "hidden" : "visible" }));
}
