//#region \0vite/modulepreload-polyfill.js
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
//#endregion
//#region src/application/catalog-loader.ts
var RETRY_DELAY_MS = 5e3;
var RetryingCatalogLoader = class {
	repository;
	scheduler;
	retryDelayMs;
	generation = 0;
	retryTimer = 0;
	abortController = null;
	constructor(repository, scheduler, retryDelayMs = RETRY_DELAY_MS) {
		this.repository = repository;
		this.scheduler = scheduler;
		this.retryDelayMs = retryDelayMs;
	}
	load(date, callbacks) {
		this.cancelCurrent();
		const generation = ++this.generation;
		this.attempt(date, callbacks, generation);
	}
	cancelCurrent() {
		this.generation += 1;
		if (this.retryTimer) this.scheduler.clearTimeout(this.retryTimer);
		this.retryTimer = 0;
		this.abortController?.abort();
		this.abortController = null;
	}
	attempt(date, callbacks, generation) {
		if (generation !== this.generation) return;
		callbacks.onLoading();
		const controller = new AbortController();
		this.abortController = controller;
		this.repository.load(date, controller.signal).then((tracks) => {
			if (generation !== this.generation || controller.signal.aborted) return;
			this.abortController = null;
			callbacks.onLoaded(tracks);
		}, (error) => {
			if (generation !== this.generation || controller.signal.aborted || error instanceof DOMException && error.name === "AbortError") return;
			this.abortController = null;
			callbacks.onError(error);
			if (!isRetryable(error)) return;
			this.retryTimer = this.scheduler.setTimeout(() => {
				this.retryTimer = 0;
				this.attempt(date, callbacks, generation);
			}, this.retryDelayMs);
		});
	}
};
function isRetryable(error) {
	return !(typeof error === "object" && error !== null && "retryable" in error && error.retryable === false);
}
//#endregion
//#region src/domain/mode-rules.ts
var SNIPPET_SECONDS = [
	1,
	2,
	4,
	8,
	16,
	32
];
var MODE_RULES = {
	classic: {
		initialTimeMs: null,
		description: "GUESS THE TRACK IN SIX TRIES AS MORE AUDIO IS REVEALED",
		roundStyle: "six-try",
		clockKind: "classic",
		clockDisplay: "snippet",
		adjustsTime: false,
		failurePolicy: "heard-fixed"
	},
	daily: {
		initialTimeMs: null,
		description: "ONE SHARED TRACK EACH DAY, GUESS IT IN SIX TRIES",
		roundStyle: "six-try",
		clockKind: "classic",
		clockDisplay: "snippet",
		adjustsTime: false,
		failurePolicy: "fixed"
	},
	blitz: {
		initialTimeMs: 6e4,
		description: "GUESS AS MANY TRACKS AS POSSIBLE BEFORE THE TIMER RUNS OUT",
		roundStyle: "timed",
		clockKind: "blitz",
		clockDisplay: "countdown",
		adjustsTime: false,
		failurePolicy: "replace"
	},
	survival: {
		initialTimeMs: 3e4,
		description: "CORRECT GUESSES ADD TIME; MISTAKES AND SKIPS DRAIN IT",
		roundStyle: "timed",
		clockKind: "survival",
		clockDisplay: "survival",
		adjustsTime: true,
		failurePolicy: "replace"
	},
	speedrun: {
		initialTimeMs: 3e4,
		description: "GUESS EVERY TRACK BEFORE TIME RUNS OUT",
		roundStyle: "timed",
		clockKind: "survival",
		clockDisplay: "survival",
		adjustsTime: true,
		failurePolicy: "replace"
	}
};
function isTimedMode(mode) {
	return mode !== null && MODE_RULES[mode].roundStyle === "timed";
}
function snippetSeconds(attempt) {
	return SNIPPET_SECONDS[Math.max(0, Math.min(SNIPPET_SECONDS.length - 1, attempt))];
}
function skipLabel(mode, attempt) {
	if (isTimedMode(mode)) return "SKIP";
	if (attempt >= SNIPPET_SECONDS.length - 1) return "GIVE UP";
	return `ADD ${SNIPPET_SECONDS[attempt + 1] - SNIPPET_SECONDS[attempt]}S`;
}
function sixTryPrompt(attempt) {
	const finalAttempt = attempt === SNIPPET_SECONDS.length - 1;
	return {
		text: finalAttempt ? "LAST CHANCE TO GUESS" : `GUESS ${attempt + 1} OUT OF ${SNIPPET_SECONDS.length}`,
		tone: finalAttempt ? "final-prompt" : "prompt"
	};
}
function timedPrompt(roundNumber) {
	return {
		text: `GUESS #${roundNumber}`,
		tone: "prompt"
	};
}
function survivalAdjustment(outcome) {
	return outcome === "correct" ? 3e3 : outcome === "wrong" ? -1e3 : -2e3;
}
function accuracy(correct, guesses) {
	return guesses > 0 ? Math.round(correct * 100 / guesses) : 0;
}
function updateDailyBest(bests, won, attempts, date) {
	if (!won || bests.daily.attempts !== 0 && attempts >= bests.daily.attempts) return {
		changed: false,
		newPersonalBest: false
	};
	bests.daily = {
		attempts,
		date
	};
	return {
		changed: true,
		newPersonalBest: true
	};
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
function updateTimedBest(bests, mode, score, runAccuracy) {
	const current = bests[mode];
	const higherScore = score > current.score;
	const strongerTie = score > 0 && score === current.score && runAccuracy > (current.accuracy ?? -1);
	if (!higherScore && !strongerTie) return {
		changed: false,
		newPersonalBest: false
	};
	bests[mode] = {
		score,
		accuracy: runAccuracy
	};
	return {
		changed: true,
		newPersonalBest: true
	};
}
function updateSpeedrunBest(bests, won, elapsedMs, trackCount) {
	if (!won || trackCount <= 0) return {
		changed: false,
		newPersonalBest: false
	};
	const current = bests.speedrun;
	const largerCatalog = trackCount > current.trackCount;
	const fasterCurrentCatalog = trackCount === current.trackCount && (current.trackCount === 0 || elapsedMs < current.timeMs);
	if (!largerCatalog && !fasterCurrentCatalog) return {
		changed: false,
		newPersonalBest: false
	};
	bests.speedrun = {
		timeMs: elapsedMs,
		trackCount
	};
	return {
		changed: true,
		newPersonalBest: true
	};
}
//#endregion
//#region src/domain/game-session.ts
var GameSession = class {
	modeState = null;
	phaseState = "idle";
	roundState = null;
	roundHeardState = false;
	attemptState = 0;
	roundNumberState = 0;
	guessesState = 0;
	correctState = 0;
	currentSlotState = null;
	historyState = [];
	guessedTrackIdsState = /* @__PURE__ */ new Set();
	speedrunCorrectTrackIdsState = /* @__PURE__ */ new Set();
	resultState = null;
	playbackRequestedState = false;
	nextSlotId = 0;
	get snapshot() {
		return {
			mode: this.modeState,
			phase: this.phaseState,
			round: this.roundState ? this.copyRound(this.roundState) : null,
			roundHeard: this.roundHeardState,
			attempt: this.attemptState,
			roundNumber: this.roundNumberState,
			guesses: this.guessesState,
			correct: this.correctState,
			currentSlot: this.currentSlotState ? { ...this.currentSlotState } : null,
			history: this.historyState.map((slot) => ({ ...slot })),
			guessedTrackIds: new Set(this.guessedTrackIdsState),
			speedrunCorrectTrackIds: new Set(this.speedrunCorrectTrackIdsState),
			result: this.resultState ? { ...this.resultState } : null,
			playbackRequested: this.playbackRequestedState
		};
	}
	reset(mode, seed = {
		attempt: 0,
		history: [],
		guessedTrackIds: /* @__PURE__ */ new Set(),
		currentSlot: null
	}) {
		this.modeState = mode;
		this.phaseState = "idle";
		this.roundState = null;
		this.roundHeardState = false;
		this.attemptState = seed.attempt;
		this.roundNumberState = 0;
		this.guessesState = 0;
		this.correctState = 0;
		this.currentSlotState = seed.currentSlot ? { ...seed.currentSlot } : null;
		this.historyState = seed.history.map((slot) => ({ ...slot }));
		this.guessedTrackIdsState.clear();
		for (const trackId of seed.guessedTrackIds) this.guessedTrackIdsState.add(trackId);
		this.speedrunCorrectTrackIdsState.clear();
		this.nextSlotId = Math.max(this.nextSlotId, seed.currentSlot?.id ?? 0, ...this.historyState.map((slot) => slot.id));
		this.resultState = null;
		this.playbackRequestedState = false;
	}
	beginPreparing(round) {
		const restorePrompt = this.phaseState === "retry";
		if (this.roundNumberState === 0) this.roundNumberState = 1;
		this.roundState = this.copyRound(round);
		this.roundHeardState = false;
		this.phaseState = "preparing";
		this.playbackRequestedState = true;
		if (!this.currentSlotState || restorePrompt) this.currentSlotState = this.prompt();
	}
	beginPlaying(round) {
		this.roundState = this.copyRound(round);
		this.roundHeardState = true;
		this.phaseState = "playing";
		this.playbackRequestedState = true;
		if (isTimedMode(this.modeState)) this.guessedTrackIdsState.clear();
		if (!this.currentSlotState) this.currentSlotState = this.prompt();
	}
	resumePlaying(round) {
		if (this.roundState?.id !== round.id) return;
		this.roundHeardState = true;
		this.phaseState = "playing";
		this.playbackRequestedState = true;
	}
	setPlaybackState(phase, requested) {
		this.phaseState = phase;
		this.playbackRequestedState = requested;
	}
	setRetry() {
		this.phaseState = "retry";
		this.playbackRequestedState = false;
	}
	showTrackError(message) {
		if (this.currentSlotState) this.currentSlotState = {
			id: this.currentSlotState.id,
			text: message,
			tone: "technical"
		};
	}
	markRoundStopped() {
		this.roundHeardState = false;
	}
	setIdle(clearRound = false) {
		this.phaseState = "idle";
		this.playbackRequestedState = false;
		if (clearRound) {
			this.roundState = null;
			this.roundHeardState = false;
		}
	}
	recordGuess(trackNumber) {
		if (this.guessedTrackIdsState.has(trackNumber)) return false;
		this.guessedTrackIdsState.add(trackNumber);
		return true;
	}
	resolveSixTry(outcome, guessedTitle) {
		if (this.modeState !== "classic" && this.modeState !== "daily") throw new Error("Six-try attempts require Classic or Daily mode.");
		const slot = this.createAttemptSlot(outcome, guessedTitle, false);
		const finished = outcome === "correct" || this.attemptState === 5;
		if (finished) this.currentSlotState = slot;
		else this.archive(slot);
		if (!finished) {
			this.attemptState += 1;
			this.currentSlotState = this.prompt();
		}
		return { finished };
	}
	resolveTimed(outcome, guessedTitle) {
		if (!isTimedMode(this.modeState)) throw new Error("Timed attempts require Blitz, Survival, or Speedrun mode.");
		const speedrunMilestone = !!(outcome === "correct" && this.modeState === "speedrun" && this.roundState && !this.speedrunCorrectTrackIdsState.has(this.roundState.track.dailyNumber));
		if (outcome === "correct" && this.modeState === "speedrun" && this.roundState) this.speedrunCorrectTrackIdsState.add(this.roundState.track.dailyNumber);
		this.archive(this.createAttemptSlot(outcome, guessedTitle, speedrunMilestone));
		if (outcome !== "skip") this.guessesState += 1;
		if (outcome === "correct") this.correctState += 1;
		this.roundNumberState += 1;
		this.currentSlotState = this.prompt();
		this.roundState = null;
		this.roundHeardState = false;
		this.phaseState = "idle";
		this.playbackRequestedState = false;
	}
	finish(result) {
		if (!this.modeState || result.mode !== this.modeState) throw new Error("Game result mode must match the active session mode.");
		this.phaseState = "result";
		this.playbackRequestedState = false;
		this.roundHeardState = false;
		if (isTimedMode(this.modeState)) {
			const speedrunWon = result.mode === "speedrun" && result.won;
			this.currentSlotState = {
				id: ++this.nextSlotId,
				text: speedrunWon ? "SPEEDRUN COMPLETE" : "TIME'S UP",
				tone: "neutral"
			};
		}
		this.resultState = { ...result };
	}
	dismissResult() {
		if (this.phaseState !== "result") return;
		this.phaseState = "idle";
		this.roundState = null;
		this.roundHeardState = false;
		this.playbackRequestedState = false;
		this.resultState = null;
	}
	prompt() {
		const prompt = isTimedMode(this.modeState) ? timedPrompt(this.roundNumberState) : sixTryPrompt(this.attemptState);
		return {
			id: ++this.nextSlotId,
			...prompt
		};
	}
	createAttemptSlot(outcome, title, speedrunMilestone) {
		let text = title;
		if (outcome === "skip") if (isTimedMode(this.modeState)) text = "SKIPPED";
		else {
			const finalGuess = this.attemptState === 5;
			const added = finalGuess ? 0 : SNIPPET_SECONDS[this.attemptState + 1] - SNIPPET_SECONDS[this.attemptState];
			text = finalGuess ? "FINAL GUESS SKIPPED" : `GUESS ${this.attemptState + 1} SKIPPED, ${added} SECOND${added === 1 ? "" : "S"} ADDED`;
		}
		const slot = {
			id: ++this.nextSlotId,
			text,
			tone: outcome
		};
		return outcome === "correct" && speedrunMilestone ? {
			...slot,
			speedrunMilestone: true
		} : slot;
	}
	archive(slot) {
		const timed = isTimedMode(this.modeState);
		const id = timed ? this.roundNumberState : this.attemptState + 1;
		this.historyState.unshift({
			...slot,
			id
		});
		if (timed && this.historyState.length > 19) this.historyState.length = 19;
	}
	copyRound(round) {
		return {
			...round,
			track: { ...round.track }
		};
	}
};
//#endregion
//#region src/domain/track-catalog.ts
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
	return value.map((candidate, index) => {
		const fail = (reason) => {
			throw new Error(`Track catalog entry ${index + 1} ${reason}`);
		};
		if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) fail("is not an object.");
		const record = candidate;
		const title = typeof record.title === "string" ? record.title.trim() : "";
		const duration = record.duration;
		const spotify = typeof record.spotify === "string" ? record.spotify.trim() : "";
		const dailyNumber = record.dailyNumber;
		const releaseDate = typeof record.releaseDate === "string" ? record.releaseDate.trim() : "";
		if (!title) fail("has no title.");
		if (titles.has(title)) fail(`duplicates title "${title}".`);
		if (typeof duration !== "number" || !Number.isFinite(duration) || duration <= 0) fail("has an invalid duration.");
		if (!Number.isSafeInteger(dailyNumber) || Number(dailyNumber) <= 0) fail("has an invalid dailyNumber.");
		if (numbers.has(Number(dailyNumber))) fail(`duplicates dailyNumber ${String(dailyNumber)}.`);
		if (spotify && !/^[A-Za-z0-9]{22}$/.test(spotify)) fail("has an invalid Spotify track ID.");
		if (!isIsoDate(releaseDate)) fail("has an invalid releaseDate.");
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
	const available = tracks.filter((track) => track.releaseDate <= date);
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
	return tracks.some((track) => track.dailyNumber === dailyNumber && track.releaseDate <= date);
}
function dailyClipStart(track, date) {
	const clip = Math.min(SNIPPET_SECONDS.at(-1), track.duration);
	const maximum = Math.max(0, Math.floor(track.duration - clip));
	return stableHash(`corzaguessr-daily-clip:${date}:${track.dailyNumber}`) % (maximum + 1);
}
function randomClipStart(track, timed, random = Math.random) {
	const clip = Math.min(timed ? 60 : SNIPPET_SECONDS.at(-1), track.duration);
	const maximum = Math.max(0, Math.floor(track.duration - clip));
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
//#endregion
//#region src/application/copy.ts
var COPY = {
	modePrompt: "SELECT A MODE TO BEGIN",
	loadingCatalog: "LOADING TRACKLIST...",
	catalogError: "COULD NOT LOAD THE TRACKLIST.",
	loadingTrack: "LOADING TRACK...",
	trackError: "COULD NOT PLAY TRACK, PRESS PLAY TO RETRY!",
	selectedTrackRetry: "THE SELECTED TRACK COULD NOT BE PLAYED. PRESS PLAY TO RETRY.",
	selectedTrackReplacing: "THE SELECTED TRACK COULD NOT BE PLAYED. TRYING ANOTHER.",
	trackUnavailable: "TRACK IS UNAVAILABLE.",
	progress: "VIEW YOUR RECORDS AND THE TRACKS YOU'VE DISCOVERED"
};
//#endregion
//#region src/application/daily-share.ts
var SHARE_URL = "https://stolenvalorhq.com/corzaguessr";
var MONTHS$1 = [
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
function formatDailyShare(date, result) {
	const attempts = Math.max(1, Math.min(6, Math.trunc(result.attempts)));
	const squares = Array.from({ length: 6 }, (_, index) => result.won && index === attempts - 1 ? "🟪" : "⬛").join(" ");
	const outcome = result.won ? `I got it in ${attempts} ${attempts === 1 ? "try" : "tries"}!` : "I didn't get it in 6 tries!";
	return `CORZAGUESSR✦ DAILY // ${formatShareDate(date)}\n\n${squares}\n${outcome}\n\n${SHARE_URL}`;
}
function formatShareDate(value) {
	const [, year, month, day] = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value) ?? [];
	const monthName = month ? MONTHS$1[Number(month) - 1] : void 0;
	return year && monthName && day ? `${monthName} ${Number(day)}, ${year}` : value;
}
//#endregion
//#region src/application/game-view-model.ts
function dailyCatalogPending(mode, tracks, dailyDate, progress) {
	if (mode !== "daily" || !tracks.length) return false;
	if (progress.date === dailyDate && progress.started && !progress.completed && progress.dailyNumber !== null) return !isDailyTrackAvailable(tracks, dailyDate, progress.dailyNumber);
	return !tracks.some((track) => track.releaseDate <= dailyDate);
}
function dailyDone(progress, date) {
	return progress.date === date && progress.completed;
}
function dailyInProgress(progress, date) {
	return progress.date === date && progress.started && !progress.completed;
}
function rulesText(input) {
	const { session, dailyProgress, dailyDate } = input;
	if (session.mode === "daily" && dailyDone(dailyProgress, dailyDate)) {
		const attempts = dailyProgress.step + 1;
		return `${dailyProgress.won ? "COMPLETED" : "FAILED"} IN ${attempts} ATTEMPT${attempts === 1 ? "" : "S"}, COME BACK TOMORROW`;
	}
	if (input.appStatus === "loading") return COPY.loadingCatalog;
	if (input.appStatus === "error") return COPY.catalogError;
	if (!session.mode) return COPY.modePrompt;
	if (session.phase === "retry") return COPY.trackError;
	if (session.mode === "daily") {
		if (dailyCatalogPending(session.mode, input.tracks, dailyDate, dailyProgress)) return COPY.trackUnavailable;
		if (dailyInProgress(dailyProgress, dailyDate)) return `DAILY IN PROGRESS, CONTINUE FROM ATTEMPT ${dailyProgress.step + 1}`;
	}
	return MODE_RULES[session.mode].description;
}
function composeGameViewModel(input) {
	const { session, transport } = input;
	const speedrunTracksLeft = Math.max(0, input.tracks.length - session.speedrunCorrectTrackIds.size);
	const currentSlot = session.mode === "speedrun" && session.currentSlot?.tone === "prompt" ? {
		...session.currentSlot,
		text: `${speedrunTracksLeft} ${speedrunTracksLeft === 1 ? "TRACK" : "TRACKS"} LEFT`
	} : session.currentSlot;
	const dailyUnavailable = dailyCatalogPending(session.mode, input.tracks, input.dailyDate, input.dailyProgress);
	const dailyBlocked = session.mode === "daily" && (dailyUnavailable || dailyDone(input.dailyProgress, input.dailyDate) && !session.round);
	const playPhase = [
		"idle",
		"playing",
		"paused",
		"buffering",
		"retry"
	].includes(session.phase) || session.phase === "preparing" && transport.pendingRoundId !== null && !session.playbackRequested;
	const inputVisible = !!session.round && ![
		"idle",
		"retry",
		"result"
	].includes(session.phase);
	const guessEnabled = !!(input.appStatus === "ready" && session.round && inputVisible && !input.overlay && !["retry", "result"].includes(session.phase));
	const acceptsAttempt = session.phase === "playing" || [
		"paused",
		"preparing",
		"buffering"
	].includes(session.phase) && session.roundHeard;
	return {
		appStatus: input.appStatus,
		mode: session.mode,
		phase: session.phase,
		rulesText: rulesText(input),
		transportText: transport.loading.visible ? COPY.loadingTrack : "",
		inputVisible,
		playEnabled: !!(input.appStatus === "ready" && session.mode && !input.overlay && !dailyBlocked && playPhase),
		guessEnabled,
		skipEnabled: !!(guessEnabled && session.round && acceptsAttempt),
		playbackIcon: session.playbackRequested ? isTimedMode(session.mode) ? "pause" : "stop" : "play",
		snippetSeconds: snippetSeconds(session.attempt),
		skipText: skipLabel(session.mode, session.attempt),
		currentSlot,
		history: session.history,
		unavailableGuessIds: session.guessedTrackIds,
		clock: input.clock,
		result: session.result,
		dailyProgress: input.dailyProgress,
		personalBests: input.personalBests,
		dailyDate: input.dailyDate,
		discoveries: input.discoveries,
		tracks: input.tracks,
		overlay: input.overlay
	};
}
//#endregion
//#region src/application/game-controller.ts
function requestsPlayback(phase) {
	return phase === "preparing" || phase === "playing" || phase === "buffering";
}
function acceptsAttempts(phase, roundHeard) {
	return phase === "playing" || (phase === "paused" || phase === "preparing" || phase === "buffering") && roundHeard;
}
var GameController = class {
	catalog;
	progress;
	clock;
	playback;
	view;
	dailyBoundary;
	navigator;
	resultClipboard;
	random;
	session = new GameSession();
	appStatus = "loading";
	tracks = [];
	budapestDate = "1970-01-01";
	dailyDate = "1970-01-01";
	overlay = null;
	sessionNumber = 0;
	nextRoundId = 0;
	finishing = false;
	persistenceFailureQueued = false;
	constructor(catalog, progress, clock, playback, view, dailyBoundary, navigator, resultClipboard, random = Math.random) {
		this.catalog = catalog;
		this.progress = progress;
		this.clock = clock;
		this.playback = playback;
		this.view = view;
		this.dailyBoundary = dailyBoundary;
		this.navigator = navigator;
		this.resultClipboard = resultClipboard;
		this.random = random;
	}
	bootstrap(date) {
		this.budapestDate = date;
		this.dailyDate = date;
		this.render();
		this.catalog.load(date, {
			onLoading: () => {
				if (!this.tracks.length) this.appStatus = "loading";
				this.render();
			},
			onLoaded: (tracks) => {
				this.tracks = tracks;
				this.appStatus = this.session.snapshot.mode ? "ready" : "awaiting-mode";
				this.prime();
				this.render();
				this.session.snapshot.mode ? this.view.focusPlay() : this.view.focusMode("daily");
			},
			onError: () => {
				if (this.tracks.length) return;
				this.appStatus = "error";
				this.view.announce(COPY.catalogError);
				this.render();
			}
		});
	}
	selectMode(mode) {
		const state = this.session.snapshot;
		if (this.overlay || this.appStatus === "error" || state.mode === mode) return;
		if (mode === "daily") {
			const date = this.dailyBoundary.start();
			this.budapestDate = date;
			this.dailyDate = date;
		} else this.dailyBoundary.stop();
		this.resetForMode(mode);
		this.view.announce(MODE_RULES[mode].description);
		if (mode === "daily" && this.progress.dailyDone(this.dailyDate)) this.view.focusMode("classic");
		else this.view.focusPlay();
	}
	play() {
		this.handlePlay(false);
	}
	playbackShortcut() {
		this.handlePlay(true);
	}
	skip() {
		this.resolveAttempt("skip", null);
	}
	guess(dailyNumber) {
		const state = this.session.snapshot;
		const round = state.round;
		if (!round || !acceptsAttempts(state.phase, state.roundHeard) || this.overlay || state.guessedTrackIds.has(dailyNumber)) return;
		const guessed = this.tracks.find((track) => track.dailyNumber === dailyNumber);
		if (!guessed || isTimedMode(state.mode) && !state.roundHeard) return;
		if (!this.session.recordGuess(dailyNumber)) return;
		this.resolveAttempt(dailyNumber === round.track.dailyNumber ? "correct" : "wrong", guessed);
	}
	resultAction() {
		const mode = this.session.snapshot.mode;
		if (!mode) return;
		if (this.overlay === "result") {
			if (mode === "daily" && this.progress.dailyDone(this.budapestDate)) {
				this.view.closeResult("classic", () => {}, () => {
					this.overlay = null;
					this.session.dismissResult();
					this.render();
				});
				return;
			}
			this.view.closeResult("play", () => {
				if (mode === "daily" && this.budapestDate) this.dailyDate = this.budapestDate;
				this.resetForMode(mode);
			}, () => {
				this.overlay = null;
				this.prime();
				this.render();
			});
			return;
		}
		this.resetForMode(mode);
	}
	openDiscovery() {
		if (this.overlay === "discovery") {
			this.closeDiscovery();
			return;
		}
		if (this.overlay || this.session.snapshot.phase === "result") return;
		if (this.playback.ownedRound) {
			this.clock.pause();
			this.playback.suspend();
			if (requestsPlayback(this.session.snapshot.phase)) this.session.setPlaybackState(this.session.snapshot.roundHeard ? "paused" : "preparing", false);
		}
		this.overlay = "discovery";
		this.view.resetTransientUi();
		this.render();
		this.view.openDiscovery();
	}
	closeDiscovery() {
		if (this.overlay !== "discovery") return;
		const returnFocus = this.session.snapshot.mode ? "play" : "discovery";
		this.view.closeDiscovery(returnFocus, () => {
			this.overlay = null;
			if (this.playback.ownedRound) this.playback.restore();
			this.prime();
			this.render();
		});
	}
	startSpeedrun() {
		if (this.overlay !== "discovery" || !this.speedrunUnlocked()) return;
		this.dailyBoundary.stop();
		this.view.closeDiscovery("play", () => {
			this.overlay = null;
			this.resetForMode("speedrun");
			this.view.announce(MODE_RULES.speedrun.description);
		});
	}
	resetProgress() {
		if (this.overlay !== "discovery") return;
		if (!this.progress.resetProgress()) {
			this.view.announce("PROGRESS COULD NOT BE RESET IN THIS BROWSER.");
			return;
		}
		this.resetToModeSelection();
		this.view.announce("ALL PROGRESS RESET.");
	}
	openSpotify() {
		const result = this.session.snapshot.result;
		const spotify = result && (result.mode === "classic" || result.mode === "daily") ? result.spotify : "";
		if (spotify) this.navigator.openSpotify(spotify);
	}
	shareDaily() {
		const result = this.session.snapshot.result;
		if (this.overlay !== "result" || result?.mode !== "daily") return;
		const sessionNumber = this.sessionNumber;
		const dailyDate = this.dailyDate;
		const stillCurrent = () => {
			return this.sessionNumber === sessionNumber && this.dailyDate === dailyDate && this.overlay === "result" && this.session.snapshot.result?.mode === "daily";
		};
		this.resultClipboard.copy(formatDailyShare(dailyDate, result)).then((copied) => {
			if (!stillCurrent()) return;
			if (copied) {
				this.view.showDailyShareCopied();
				this.view.announce("RESULT COPIED TO CLIPBOARD.");
			} else this.view.announce("RESULT COULD NOT BE COPIED IN THIS BROWSER.");
		}, () => {
			if (stillCurrent()) this.view.announce("RESULT COULD NOT BE COPIED IN THIS BROWSER.");
		});
	}
	openDiscoverySpotify(dailyNumber) {
		if (this.overlay !== "discovery" || !this.progress.discoveries.has(dailyNumber)) return;
		const spotify = this.tracks.find((track) => track.dailyNumber === dailyNumber)?.spotify ?? "";
		if (spotify) this.navigator.openSpotify(spotify);
	}
	handleDateChanged(date) {
		if (this.session.snapshot.mode !== "daily" || date === this.budapestDate) return;
		this.budapestDate = date;
		if (this.session.snapshot.phase !== "result") {
			this.dailyDate = date;
			this.resetForMode("daily");
		}
	}
	handleVisibilityVisible() {
		if (this.playback.ownedRound && !this.overlay) this.playback.restore();
		if (this.session.snapshot.mode === "daily") this.dailyBoundary.reconcile();
	}
	handleVisibilityHidden() {
		const state = this.session.snapshot;
		if (!this.playback.ownedRound || state.phase === "result") return;
		this.clock.pause();
		this.playback.suspend();
		if (requestsPlayback(state.phase)) {
			this.session.setPlaybackState(state.roundHeard ? "paused" : "preparing", false);
			this.render();
		}
	}
	onPending(round) {
		this.session.beginPreparing(round);
		if (this.session.snapshot.mode === "daily") this.progress.markDailyStarted(this.dailyDate, round.track, this.session.snapshot.attempt);
		this.render();
	}
	onAudioPlaying(round, startedNewRound) {
		if (startedNewRound) {
			this.session.beginPlaying(round);
			if (!isTimedMode(this.session.snapshot.mode)) this.clock.restartClassic(snippetSeconds(this.session.snapshot.attempt) * 1e3);
			this.clock.start();
			this.render();
			this.view.focusGuess();
			return;
		}
		if (this.session.snapshot.round?.id === round.id) {
			this.session.resumePlaying(round);
			this.clock.start();
			this.render();
		}
	}
	onAudioWaiting(round) {
		if (this.playback.ownedRound?.id !== round.id) return;
		this.clock.pause();
		this.session.setPlaybackState("buffering", true);
		this.render();
	}
	onAudioBlocked(round) {
		if (this.playback.ownedRound?.id !== round.id) return;
		this.clock.pause();
		this.session.setPlaybackState(this.session.snapshot.roundHeard ? "paused" : "preparing", false);
		this.view.announce("PRESS PLAY TO START THE AUDIO.");
		this.render();
	}
	onAudioEnded(round) {
		const state = this.session.snapshot;
		if (state.round?.id !== round.id || !state.roundHeard || state.phase === "result") return;
		this.clock.pause();
		this.session.setPlaybackState("paused", false);
		if (isTimedMode(state.mode)) this.resolveAttempt("skip", null);
		else this.render();
	}
	onAudioRecovery(kind) {
		this.clock.pause();
		if (kind === "automatic-replacement") {
			this.session.setIdle(true);
			this.view.announce(COPY.selectedTrackReplacing);
			return;
		}
		this.session.setRetry();
		this.session.showTrackError(COPY.trackError);
		this.view.announce(kind === "selected-track-retry" ? COPY.selectedTrackRetry : COPY.trackError);
		this.render();
		this.view.focusPlay();
	}
	onLoading() {
		this.render();
	}
	onProgressPersistenceFailure(failure) {
		if (failure.operation === "reset-progress" || this.persistenceFailureQueued) return;
		this.persistenceFailureQueued = true;
		queueMicrotask(() => {
			this.persistenceFailureQueued = false;
			this.view.announce("PROGRESS COULD NOT BE SAVED IN THIS BROWSER.");
		});
	}
	onClockTick(snapshot) {
		this.view.renderClock(snapshot);
	}
	onClockExpired() {
		const state = this.session.snapshot;
		if (this.finishing || state.phase === "result" || !state.round) return;
		if (isTimedMode(state.mode)) this.finishGame(false);
		else {
			this.playback.pause();
			this.session.setPlaybackState("paused", false);
			this.render();
		}
	}
	handlePlay(shortcut) {
		if (this.session.snapshot.mode === "daily") this.dailyBoundary.reconcile();
		const state = this.session.snapshot;
		if (this.appStatus !== "ready" || !state.mode || this.overlay || this.dailyCatalogPending() || state.mode === "daily" && this.progress.dailyDone(this.dailyDate) && !state.round) return;
		if (state.phase === "idle" || state.phase === "retry") {
			this.playback.start({ manualRetry: state.phase === "retry" });
			return;
		}
		if (state.phase === "preparing" && state.round && this.playback.snapshot.pendingRoundId === state.round.id && !state.playbackRequested) {
			this.session.setPlaybackState("preparing", true);
			this.playback.replay(state.round, false);
			this.render();
			return;
		}
		const round = state.round;
		if (!round || ![
			"playing",
			"paused",
			"buffering"
		].includes(state.phase)) return;
		if (isTimedMode(state.mode)) {
			if (state.playbackRequested) {
				this.clock.pause();
				this.playback.pause();
				this.session.setPlaybackState("paused", false);
				this.render();
				this.view.focusGuess();
			} else {
				this.session.setPlaybackState("paused", true);
				this.playback.replay(round, false);
				this.render();
				this.view.focusGuess();
			}
			return;
		}
		if (shortcut) {
			const snapshot = this.clock.pause();
			this.playback.pause();
			this.session.markRoundStopped();
			this.session.setPlaybackState("paused", true);
			this.playback.replay(round, snapshot.elapsedMs > 0);
			if (snapshot.elapsedMs > 0) this.view.beginProgressReset(true);
			this.clock.restartClassic(snippetSeconds(state.attempt) * 1e3);
			this.render();
			this.view.focusGuess();
		} else if (state.playbackRequested) {
			this.clock.pause();
			this.playback.pause();
			this.view.beginProgressReset(true);
			this.clock.restartClassic(snippetSeconds(state.attempt) * 1e3);
			this.session.setPlaybackState("paused", false);
			this.render();
			this.view.focusGuess();
		} else {
			const elapsed = this.clock.snapshot().elapsedMs;
			this.session.markRoundStopped();
			this.session.setPlaybackState("paused", true);
			this.playback.replay(round, elapsed > 0);
			if (elapsed > 0) this.view.beginProgressReset(true);
			this.clock.restartClassic(snippetSeconds(state.attempt) * 1e3);
			this.render();
			this.view.focusGuess();
		}
	}
	resolveAttempt(outcome, guessed) {
		const state = this.session.snapshot;
		const round = state.round;
		const mode = state.mode;
		if (!round || !mode || !acceptsAttempts(state.phase, state.roundHeard) || this.overlay || this.finishing) return;
		if (isTimedMode(mode)) {
			const snapshot = this.clock.pause();
			if (snapshot.expired || snapshot.remainingMs <= 0) {
				this.finishGame(false);
				return;
			}
		}
		this.view.clearAttemptEntry();
		if (outcome === "correct") this.progress.recordDiscovery(round.track.dailyNumber);
		if (isTimedMode(mode)) {
			this.playback.pause();
			this.session.resolveTimed(outcome, guessed?.title ?? "");
			const speedrunComplete = mode === "speedrun" && outcome === "correct" && this.session.snapshot.speedrunCorrectTrackIds.size === this.tracks.length;
			this.view.announce(speedrunComplete ? "CORRECT. SPEEDRUN COMPLETE." : outcome === "correct" ? "CORRECT." : outcome === "wrong" ? "INCORRECT." : "SKIPPED.");
			if (speedrunComplete) {
				this.finishGame(true, round);
				return;
			}
			if (MODE_RULES[mode].adjustsTime) {
				const adjustment = survivalAdjustment(outcome);
				this.view.flashSurvivalChange(adjustment / 1e3);
				const snapshot = this.clock.adjust(adjustment);
				if (snapshot.expired || snapshot.remainingMs <= 0) {
					this.finishGame(false, round);
					return;
				}
			}
			this.playback.start();
			return;
		}
		const clockWasRunning = state.playbackRequested && this.clock.snapshot().running;
		const resolution = this.session.resolveSixTry(outcome, guessed?.title ?? "");
		this.view.announce(outcome === "correct" ? "CORRECT." : outcome === "wrong" ? "INCORRECT. TRY AGAIN." : "SKIPPED. MORE TIME ADDED.");
		if (resolution.finished) {
			this.finishGame(outcome === "correct");
			return;
		}
		if (mode === "daily" && this.progress.dailyInProgress(this.dailyDate)) {
			const updated = this.session.snapshot;
			this.progress.updateDailyAttempt(updated.attempt, updated.history);
		}
		const limit = snippetSeconds(this.session.snapshot.attempt) * 1e3;
		if (clockWasRunning) this.clock.extendClassic(limit);
		else {
			const elapsed = this.clock.snapshot().elapsedMs;
			this.session.markRoundStopped();
			this.session.setPlaybackState("paused", true);
			this.playback.replay(round, true);
			if (elapsed > 0) this.view.beginProgressReset(true);
			this.clock.restartClassic(limit);
		}
		this.render();
		this.view.focusGuess();
	}
	finishGame(won, fallbackRound = null) {
		const state = this.session.snapshot;
		const round = state.round ?? fallbackRound;
		const mode = state.mode;
		if (!round || !mode || state.phase === "result" || this.finishing) return;
		this.finishing = true;
		const clock = this.clock.pause();
		this.playback.stop();
		const result = this.progress.finish(finishedRun(mode, won, round, state, clock, this.dailyDate, this.tracks.length));
		this.session.finish(result);
		this.overlay = "result";
		this.view.resetTransientUi();
		this.render();
		this.view.openResult();
		this.finishing = false;
	}
	resetForMode(mode) {
		this.sessionNumber += 1;
		const seed = mode === "daily" ? this.progress.dailySessionSeed(this.dailyDate, this.tracks) : void 0;
		const resumed = seed?.attempt ?? 0;
		this.session.reset(mode, seed);
		const rule = MODE_RULES[mode];
		const initial = rule.initialTimeMs;
		const milliseconds = initial ?? snippetSeconds(resumed) * 1e3;
		this.view.beginProgressReset();
		this.clock.configure(initial === null ? {
			kind: "classic",
			initialMs: milliseconds,
			limitMs: milliseconds
		} : {
			kind: rule.clockKind,
			initialMs: milliseconds
		});
		this.playback.configure(mode, (failed, avoid) => this.createRound(mode, failed, avoid));
		this.appStatus = this.tracks.length ? "ready" : this.appStatus;
		this.view.resetTransientUi();
		this.prime();
		this.render();
	}
	resetToModeSelection() {
		this.dailyBoundary.stop();
		this.sessionNumber += 1;
		this.playback.reset();
		this.session.reset(null);
		this.view.beginProgressReset();
		this.clock.configure({
			kind: "classic",
			initialMs: 1e3,
			limitMs: 1e3
		});
		if (this.tracks.length) this.appStatus = "awaiting-mode";
		this.view.resetTransientUi();
		this.render();
	}
	createRound(mode, failed, avoid) {
		let track;
		let clipStart;
		if (mode === "daily") {
			track = selectDailyTrack(this.tracks, this.dailyDate, this.progress.dailyInProgress(this.dailyDate) ? this.progress.daily.dailyNumber : null);
			if (!track) return null;
			clipStart = dailyClipStart(track, this.dailyDate);
		} else {
			track = selectRandomTrack(this.tracks, failed, avoid, this.random);
			if (!track) return null;
			clipStart = randomClipStart(track, isTimedMode(mode), this.random);
		}
		return {
			id: ++this.nextRoundId,
			track,
			clipStart
		};
	}
	prime() {
		const state = this.session.snapshot;
		if (!state.mode || !this.tracks.length || this.overlay || this.dailyCatalogPending() || state.mode === "daily" && this.progress.dailyDone(this.dailyDate)) return;
		this.playback.prime();
	}
	dailyCatalogPending() {
		return dailyCatalogPending(this.session.snapshot.mode, this.tracks, this.dailyDate, this.progress.daily);
	}
	speedrunUnlocked() {
		return summarizeDiscovery(this.tracks, this.progress.discoveries).complete;
	}
	render() {
		const session = this.session.snapshot;
		const viewModel = composeGameViewModel({
			appStatus: this.appStatus,
			session,
			transport: this.playback.snapshot,
			clock: this.clock.snapshot(),
			dailyProgress: this.progress.daily,
			personalBests: this.progress.personalBests,
			dailyDate: this.dailyDate,
			discoveries: this.progress.discoveries,
			tracks: this.tracks,
			overlay: this.overlay
		});
		this.view.render(viewModel, String(this.sessionNumber));
	}
};
function finishedRun(mode, won, round, state, clock, dailyDate, catalogTrackCount) {
	switch (mode) {
		case "daily": return {
			mode,
			won,
			track: round.track,
			attempt: state.attempt,
			dailyDate,
			currentSlot: state.currentSlot,
			history: state.history
		};
		case "classic": return {
			mode,
			won,
			track: round.track,
			attempt: state.attempt
		};
		case "blitz": return {
			mode,
			correct: state.correct,
			guesses: state.guesses
		};
		case "survival": return {
			mode,
			correct: state.correct,
			guesses: state.guesses,
			elapsedMs: clock.elapsedMs
		};
		case "speedrun": return {
			mode,
			won,
			elapsedMs: clock.elapsedMs,
			completedTrackCount: state.speedrunCorrectTrackIds.size,
			catalogTrackCount
		};
	}
}
//#endregion
//#region src/domain/progress-defaults.ts
function emptyDailyProgress() {
	return {
		date: "",
		dailyNumber: null,
		started: false,
		completed: false,
		won: false,
		step: 0,
		history: []
	};
}
function emptyPersonalBests() {
	return {
		classic: {
			current: 0,
			best: 0,
			snippetTotal: 0,
			bestSnippetTotal: 0
		},
		daily: {
			attempts: 0,
			date: ""
		},
		blitz: {
			score: 0,
			accuracy: null
		},
		survival: {
			score: 0,
			accuracy: null
		},
		speedrun: {
			timeMs: 0,
			trackCount: 0
		}
	};
}
//#endregion
//#region src/application/progress-service.ts
var ProgressService = class {
	repository;
	options;
	discoveriesState = /* @__PURE__ */ new Set();
	dailyState;
	bestsState;
	constructor(repository, options = {}) {
		this.repository = repository;
		this.options = options;
		const loaded = repository.load();
		this.discoveriesState = new Set(loaded.discoveries);
		this.dailyState = cloneDaily(loaded.daily);
		this.bestsState = cloneBests(loaded.personalBests);
	}
	get discoveries() {
		return new Set(this.discoveriesState);
	}
	get daily() {
		return cloneDaily(this.dailyState);
	}
	get personalBests() {
		return cloneBests(this.bestsState);
	}
	dailyDone(date) {
		return this.dailyState.date === date && this.dailyState.completed;
	}
	dailyInProgress(date) {
		return this.dailyState.date === date && this.dailyState.started && !this.dailyState.completed;
	}
	dailySessionSeed(date, tracks) {
		if (this.dailyState.date !== date || !this.dailyState.started) return {
			attempt: 0,
			history: [],
			guessedTrackIds: /* @__PURE__ */ new Set(),
			currentSlot: null
		};
		const attempts = this.dailyState.history;
		const currentSlot = this.dailyState.completed ? attempts[0] ?? null : null;
		const history = this.dailyState.completed ? attempts.slice(1) : attempts;
		const guessedTrackIds = new Set(attempts.filter((slot) => slot.tone === "wrong").map((slot) => tracks.find((track) => track.title === slot.text)?.dailyNumber).filter((trackNumber) => trackNumber !== void 0));
		return {
			attempt: this.dailyState.step,
			history: history.map((slot) => ({ ...slot })),
			guessedTrackIds,
			currentSlot: currentSlot ? { ...currentSlot } : null
		};
	}
	markDailyStarted(date, track, attempt) {
		if (this.dailyInProgress(date)) return true;
		const next = {
			date,
			dailyNumber: track.dailyNumber,
			started: true,
			completed: false,
			won: false,
			step: attempt,
			history: []
		};
		if (!this.repository.saveDaily(next)) return this.persistenceFailed("start-daily");
		this.dailyState = next;
		return true;
	}
	updateDailyAttempt(step, history) {
		if (!this.dailyState.started || this.dailyState.completed) return true;
		const next = {
			...this.dailyState,
			step,
			history: history.map((slot) => ({ ...slot }))
		};
		if (!this.repository.saveDaily(next)) return this.persistenceFailed("advance-daily");
		this.dailyState = next;
		return true;
	}
	recordDiscovery(trackNumber) {
		if (this.discoveriesState.has(trackNumber)) return true;
		const next = new Set(this.discoveriesState).add(trackNumber);
		if (!this.repository.saveDiscoveries(next)) {
			this.persistenceFailed("record-discovery");
			return false;
		}
		this.discoveriesState = next;
		return true;
	}
	resetProgress() {
		if (!this.repository.clearProgress()) return this.persistenceFailed("reset-progress");
		this.discoveriesState.clear();
		this.dailyState = emptyDailyProgress();
		this.bestsState = emptyPersonalBests();
		return true;
	}
	finish(run) {
		if (run.mode === "daily") {
			const completedHistory = run.currentSlot ? [{
				...run.currentSlot,
				id: run.attempt + 1
			}, ...run.history.map((slot) => ({ ...slot }))] : [];
			const nextDaily = {
				date: run.dailyDate,
				dailyNumber: run.track.dailyNumber,
				started: true,
				completed: true,
				won: run.won,
				step: run.attempt,
				history: completedHistory
			};
			const dailyPersisted = this.repository.saveDaily(nextDaily);
			if (dailyPersisted) this.dailyState = nextDaily;
			else this.persistenceFailed("complete-daily");
			const nextBests = cloneBests(this.bestsState);
			const update = updateDailyBest(nextBests, run.won, run.attempt + 1, run.dailyDate);
			const bestPersisted = !update.changed || dailyPersisted && this.saveBests(nextBests);
			if (update.changed && bestPersisted) this.bestsState = nextBests;
			return {
				mode: "daily",
				won: run.won,
				trackTitle: run.track.title,
				spotify: run.track.spotify,
				newPersonalBest: update.newPersonalBest && bestPersisted,
				attempts: run.attempt + 1,
				bestAttempts: this.bestsState.daily.attempts
			};
		}
		if (run.mode === "classic") {
			const nextBests = cloneBests(this.bestsState);
			const update = updateClassicBest(nextBests, run.won, run.attempt);
			const bestPersisted = !update.changed || this.saveBests(nextBests);
			if (update.changed && bestPersisted) this.bestsState = nextBests;
			const best = this.bestsState.classic;
			return {
				mode: "classic",
				won: run.won,
				trackTitle: run.track.title,
				spotify: run.track.spotify,
				newPersonalBest: update.newPersonalBest && bestPersisted,
				streak: update.streak,
				average: update.average,
				bestStreak: best.best,
				bestAverage: best.best ? best.bestSnippetTotal / best.best : 0
			};
		}
		if (run.mode === "blitz") {
			const runAccuracy = accuracy(run.correct, run.guesses);
			const nextBests = cloneBests(this.bestsState);
			const update = updateTimedBest(nextBests, "blitz", run.correct, runAccuracy);
			const bestPersisted = !update.changed || this.saveBests(nextBests);
			if (update.changed && bestPersisted) this.bestsState = nextBests;
			return {
				mode: "blitz",
				newPersonalBest: update.newPersonalBest && bestPersisted,
				correct: run.correct,
				accuracy: runAccuracy,
				bestCorrect: this.bestsState.blitz.score,
				bestAccuracy: this.bestsState.blitz.accuracy
			};
		}
		if (run.mode === "speedrun") {
			const elapsedMs = Math.floor(run.elapsedMs / 1e3) * 1e3;
			const completedTracks = run.completedTrackCount;
			const catalogTrackCount = run.catalogTrackCount;
			const completed = run.won && catalogTrackCount > 0 && completedTracks >= catalogTrackCount;
			const nextBests = cloneBests(this.bestsState);
			const update = updateSpeedrunBest(nextBests, completed, elapsedMs, catalogTrackCount);
			const bestPersisted = !update.changed || this.saveBests(nextBests);
			if (update.changed && bestPersisted) this.bestsState = nextBests;
			return {
				mode: "speedrun",
				won: completed,
				newPersonalBest: update.newPersonalBest && bestPersisted,
				elapsedMs,
				completedTracks,
				catalogTrackCount,
				bestElapsedMs: this.bestsState.speedrun.timeMs,
				bestTrackCount: this.bestsState.speedrun.trackCount
			};
		}
		const runAccuracy = accuracy(run.correct, run.guesses);
		const elapsedMs = Math.floor(run.elapsedMs / 1e3) * 1e3;
		const nextBests = cloneBests(this.bestsState);
		const update = updateTimedBest(nextBests, "survival", elapsedMs, runAccuracy);
		const bestPersisted = !update.changed || this.saveBests(nextBests);
		if (update.changed && bestPersisted) this.bestsState = nextBests;
		return {
			mode: "survival",
			newPersonalBest: update.newPersonalBest && bestPersisted,
			elapsedMs,
			accuracy: runAccuracy,
			bestElapsedMs: this.bestsState.survival.score,
			bestAccuracy: this.bestsState.survival.accuracy
		};
	}
	saveBests(next) {
		if (this.repository.savePersonalBests(next)) return true;
		return this.persistenceFailed("save-personal-bests");
	}
	persistenceFailed(operation) {
		this.options.onPersistenceFailure?.({ operation });
		return false;
	}
};
function cloneDaily(progress) {
	return {
		...progress,
		history: progress.history.map((slot) => ({ ...slot }))
	};
}
function cloneBests(bests) {
	return {
		classic: { ...bests.classic },
		daily: { ...bests.daily },
		blitz: { ...bests.blitz },
		survival: { ...bests.survival },
		speedrun: { ...bests.speedrun }
	};
}
//#endregion
//#region src/application/track-assets.ts
function trackAssetNumber(dailyNumber) {
	return String(dailyNumber).padStart(2, "0");
}
//#endregion
//#region src/platform/browser-external-navigator.ts
var BrowserExternalNavigator = class {
	openSpotify(trackId) {
		window.open(`https://open.spotify.com/track/${trackId}`, "_blank", "noopener,noreferrer");
	}
};
//#endregion
//#region src/platform/browser-result-clipboard.ts
var BrowserResultClipboard = class {
	target;
	constructor(target = navigator) {
		this.target = target;
	}
	async copy(text) {
		try {
			if (!this.target.clipboard) return false;
			await this.target.clipboard.writeText(text);
			return true;
		} catch {
			return false;
		}
	}
};
//#endregion
//#region src/platform/budapest-date-boundary.ts
var BUDAPEST_DATE_FORMATTER = new Intl.DateTimeFormat("en", {
	timeZone: "Europe/Budapest",
	year: "numeric",
	month: "2-digit",
	day: "2-digit"
});
function budapestDate(date = /* @__PURE__ */ new Date()) {
	const parts = Object.fromEntries(BUDAPEST_DATE_FORMATTER.formatToParts(date).map(({ type, value }) => [type, value]));
	return `${parts.year}-${parts.month}-${parts.day}`;
}
var browserRuntime = {
	now: () => Date.now(),
	setTimeout: (callback, delayMs) => window.setTimeout(callback, delayMs),
	clearTimeout: (handle) => window.clearTimeout(handle)
};
var BudapestDateBoundary = class {
	onDateChanged;
	runtime;
	timer = 0;
	currentDate = "";
	active = false;
	constructor(onDateChanged, runtime = browserRuntime) {
		this.onDateChanged = onDateChanged;
		this.runtime = runtime;
	}
	current() {
		const date = budapestDate(new Date(this.runtime.now()));
		if (!this.currentDate) this.currentDate = date;
		return date;
	}
	start() {
		this.active = true;
		this.currentDate = budapestDate(new Date(this.runtime.now()));
		this.scheduleNextBoundary();
		return this.currentDate;
	}
	reconcile() {
		const date = budapestDate(new Date(this.runtime.now()));
		if (date !== this.currentDate) {
			this.currentDate = date;
			this.onDateChanged(date);
		}
		if (this.active) this.scheduleNextBoundary();
		return date;
	}
	stop() {
		this.active = false;
		if (this.timer) this.runtime.clearTimeout(this.timer);
		this.timer = 0;
	}
	scheduleNextBoundary() {
		if (!this.active) return;
		if (this.timer) this.runtime.clearTimeout(this.timer);
		this.timer = 0;
		const now = this.runtime.now();
		const today = budapestDate(new Date(now));
		let lower = now;
		let upper = now + 1800 * 60 * 1e3;
		while (budapestDate(new Date(upper)) === today) upper += 360 * 60 * 1e3;
		while (upper - lower > 1) {
			const middle = Math.floor((lower + upper) / 2);
			if (budapestDate(new Date(middle)) === today) lower = middle;
			else upper = middle;
		}
		this.timer = this.runtime.setTimeout(() => this.reconcile(), Math.max(1, upper - now));
	}
};
//#endregion
//#region src/platform/catalog-repository.ts
var CatalogLoadError = class extends Error {
	kind;
	retryable;
	constructor(kind, message, options) {
		super(message, options);
		this.kind = kind;
		this.name = "CatalogLoadError";
		this.retryable = kind !== "invalid-date";
	}
};
var FetchTrackCatalogRepository = class {
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
//#endregion
//#region src/platform/game-clock.ts
var browserScheduler$1 = {
	requestFrame: (callback) => requestAnimationFrame(callback),
	cancelFrame: (handle) => cancelAnimationFrame(handle),
	setTimer: (callback, delay) => window.setTimeout(callback, delay),
	clearTimer: (handle) => window.clearTimeout(handle)
};
var GameClock = class {
	callbacks;
	now;
	scheduler;
	config = {
		kind: "classic",
		initialMs: 1e3,
		limitMs: 1e3
	};
	running = false;
	anchorMs = null;
	elapsedMs = 0;
	remainingMs = 1e3;
	maxRemainingMs = 1e3;
	expired = false;
	frame = 0;
	timer = 0;
	generation = 0;
	constructor(callbacks, now = () => performance.now(), scheduler = browserScheduler$1) {
		this.callbacks = callbacks;
		this.now = now;
		this.scheduler = scheduler;
	}
	configure(configuration) {
		this.cancelScheduled();
		this.config = {
			...configuration,
			limitMs: configuration.limitMs ?? configuration.initialMs
		};
		this.running = false;
		this.anchorMs = null;
		this.elapsedMs = 0;
		this.remainingMs = configuration.initialMs;
		this.maxRemainingMs = configuration.initialMs;
		this.expired = false;
		this.generation += 1;
		this.callbacks.onTick(this.snapshot());
	}
	start() {
		if (this.running || this.expired) return;
		this.running = true;
		this.anchorMs = this.now();
		this.schedule();
	}
	pause() {
		this.commit();
		this.running = false;
		this.anchorMs = null;
		this.generation += 1;
		this.cancelScheduled();
		const snapshot = this.snapshot();
		this.callbacks.onTick(snapshot);
		return snapshot;
	}
	restartClassic(milliseconds) {
		this.cancelScheduled();
		this.config = {
			kind: "classic",
			initialMs: milliseconds,
			limitMs: milliseconds
		};
		this.running = false;
		this.anchorMs = null;
		this.elapsedMs = 0;
		this.remainingMs = milliseconds;
		this.maxRemainingMs = milliseconds;
		this.expired = false;
		this.generation += 1;
		this.callbacks.onTick(this.snapshot());
	}
	extendClassic(milliseconds) {
		const wasRunning = this.running;
		this.commit();
		this.config = {
			kind: "classic",
			initialMs: milliseconds,
			limitMs: milliseconds
		};
		this.remainingMs = Math.max(0, milliseconds - this.elapsedMs);
		this.maxRemainingMs = Math.max(this.maxRemainingMs, milliseconds);
		this.expired = this.remainingMs === 0;
		this.anchorMs = wasRunning && !this.expired ? this.now() : null;
		this.running = wasRunning && !this.expired;
		this.generation += 1;
		this.cancelScheduled();
		if (this.running) this.schedule();
		this.callbacks.onTick(this.snapshot());
	}
	adjust(milliseconds) {
		this.commit();
		this.remainingMs = Math.max(0, this.remainingMs + milliseconds);
		this.maxRemainingMs = Math.max(this.maxRemainingMs, this.remainingMs);
		this.expired = this.remainingMs === 0;
		if (this.running && !this.expired) this.anchorMs = this.now();
		if (this.expired) {
			this.running = false;
			this.anchorMs = null;
			this.cancelScheduled();
		} else if (this.running) {
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
			kind: this.config.kind,
			running: this.running,
			elapsedMs: projected.elapsedMs,
			remainingMs: projected.remainingMs,
			limitMs: this.config.limitMs,
			maxRemainingMs: this.maxRemainingMs,
			expired: this.expired || projected.remainingMs <= 0
		};
	}
	project(at) {
		if (!this.running || this.anchorMs === null) return {
			elapsedMs: this.elapsedMs,
			remainingMs: this.remainingMs
		};
		const delta = Math.max(0, at - this.anchorMs);
		return {
			elapsedMs: this.elapsedMs + delta,
			remainingMs: this.config.kind === "classic" ? Math.max(0, this.config.limitMs - (this.elapsedMs + delta)) : Math.max(0, this.remainingMs - delta)
		};
	}
	commit() {
		if (!this.running || this.anchorMs === null) return;
		const now = this.now();
		const projected = this.project(now);
		this.elapsedMs = projected.elapsedMs;
		this.remainingMs = projected.remainingMs;
		this.anchorMs = now;
		if (this.remainingMs <= 0) this.expired = true;
	}
	schedule() {
		const generation = this.generation;
		const tick = () => {
			if (!this.running || generation !== this.generation) return;
			const snapshot = this.snapshot();
			this.callbacks.onTick(snapshot);
			if (snapshot.remainingMs > 0) this.frame = this.scheduler.requestFrame(tick);
		};
		this.frame = this.scheduler.requestFrame(tick);
		this.timer = this.scheduler.setTimer(() => {
			if (!this.running || generation !== this.generation) return;
			this.commit();
			this.running = false;
			this.anchorMs = null;
			this.remainingMs = 0;
			this.expired = true;
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
//#endregion
//#region src/platform/progress-repository.ts
var STORAGE_KEYS = {
	discoveries: "corzaguessr:discoveries",
	daily: "corzaguessr:daily",
	personalBests: "corzaguessr:personal-bests"
};
function parseDailyProgress(value) {
	if (!isRecord(value) || !hasExactKeys(value, [
		"date",
		"dailyNumber",
		"started",
		"completed",
		"won",
		"step",
		"history"
	])) return emptyDailyProgress();
	if (typeof value.date !== "string" || !isIsoDate(value.date) || !isPositiveInteger(value.dailyNumber) || value.started !== true || typeof value.completed !== "boolean" || typeof value.won !== "boolean" || !isIntegerBetween(value.step, 0, 5) || !Array.isArray(value.history) || !value.completed && value.won || value.completed && value.history.length !== value.step + 1 || !value.completed && value.history.length !== value.step) return emptyDailyProgress();
	const history = [];
	for (let index = 0; index < value.history.length; index += 1) {
		const candidate = value.history[index];
		if (!isRecord(candidate) || !hasExactKeys(candidate, [
			"id",
			"text",
			"tone"
		])) return emptyDailyProgress();
		const expectedId = value.completed ? value.step + 1 - index : value.step - index;
		const validTone = value.completed && index === 0 ? value.won && candidate.tone === "correct" || !value.won && (candidate.tone === "wrong" || candidate.tone === "skip") : candidate.tone === "wrong" || candidate.tone === "skip";
		if (candidate.id !== expectedId || typeof candidate.text !== "string" || candidate.text.trim() !== candidate.text || candidate.text.length < 1 || candidate.text.length > 500 || !validTone) return emptyDailyProgress();
		history.push({
			id: candidate.id,
			text: candidate.text,
			tone: candidate.tone
		});
	}
	return {
		date: value.date,
		dailyNumber: value.dailyNumber,
		started: true,
		completed: value.completed,
		won: value.won,
		step: value.step,
		history
	};
}
function parsePersonalBests(value) {
	if (!isRecord(value) || !hasExactKeys(value, [
		"classic",
		"daily",
		"blitz",
		"survival",
		"speedrun"
	])) return emptyPersonalBests();
	const { classic, daily, blitz, survival, speedrun } = value;
	if (!isRecord(classic) || !hasExactKeys(classic, [
		"current",
		"best",
		"snippetTotal",
		"bestSnippetTotal"
	]) || !isNonNegativeInteger(classic.current) || !isNonNegativeInteger(classic.best) || !isNonNegativeInteger(classic.snippetTotal) || !isNonNegativeInteger(classic.bestSnippetTotal) || classic.best < classic.current || !validSnippetTotal(classic.current, classic.snippetTotal) || !validSnippetTotal(classic.best, classic.bestSnippetTotal) || classic.current === classic.best && classic.bestSnippetTotal > classic.snippetTotal || !validDailyBest(daily) || !validScoreBest(blitz, false) || !validScoreBest(survival, true) || !validSpeedrunBest(speedrun)) return emptyPersonalBests();
	return {
		classic: {
			current: classic.current,
			best: classic.best,
			snippetTotal: classic.snippetTotal,
			bestSnippetTotal: classic.bestSnippetTotal
		},
		daily: {
			attempts: daily.attempts,
			date: daily.date
		},
		blitz: {
			score: blitz.score,
			accuracy: blitz.accuracy
		},
		survival: {
			score: survival.score,
			accuracy: survival.accuracy
		},
		speedrun: {
			timeMs: speedrun.timeMs,
			trackCount: speedrun.trackCount
		}
	};
}
function validSpeedrunBest(value) {
	if (!isRecord(value) || !hasExactKeys(value, ["timeMs", "trackCount"]) || !isNonNegativeInteger(value.timeMs) || value.timeMs % 1e3 !== 0 || !isNonNegativeInteger(value.trackCount)) return false;
	return value.trackCount === 0 ? value.timeMs === 0 : true;
}
function validDailyBest(value) {
	if (!isRecord(value) || !hasExactKeys(value, ["attempts", "date"]) || !isIntegerBetween(value.attempts, 0, 6) || typeof value.date !== "string") return false;
	return value.attempts === 0 ? value.date === "" : isIsoDate(value.date);
}
function parseDiscoveries(value) {
	if (!Array.isArray(value)) return /* @__PURE__ */ new Set();
	const discoveries = /* @__PURE__ */ new Set();
	for (const candidate of value) {
		if (!isPositiveInteger(candidate) || discoveries.has(candidate)) return /* @__PURE__ */ new Set();
		discoveries.add(candidate);
	}
	return discoveries;
}
function validScoreBest(value, survival) {
	if (!isRecord(value) || !hasExactKeys(value, ["score", "accuracy"]) || !isNonNegativeInteger(value.score) || survival && value.score % 1e3 !== 0) return false;
	if (value.score === 0) return value.accuracy === null;
	return isIntegerBetween(value.accuracy, 0, 100);
}
function validSnippetTotal(streak, total) {
	return streak === 0 ? total === 0 : total >= streak && total <= streak * 32;
}
function isRecord(value) {
	return !!value && typeof value === "object" && !Array.isArray(value);
}
function hasExactKeys(value, expected) {
	const actual = Object.keys(value).sort();
	return actual.length === expected.length && [...expected].sort().every((key, index) => actual[index] === key);
}
function isPositiveInteger(value) {
	return Number.isSafeInteger(value) && Number(value) > 0;
}
function isNonNegativeInteger(value) {
	return Number.isSafeInteger(value) && Number(value) >= 0;
}
function isIntegerBetween(value, minimum, maximum) {
	return Number.isSafeInteger(value) && Number(value) >= minimum && Number(value) <= maximum;
}
function browserStorage$1() {
	try {
		return window.localStorage;
	} catch {
		return null;
	}
}
var LocalStorageProgressRepository = class {
	storage;
	constructor(storage = browserStorage$1()) {
		this.storage = storage;
	}
	load() {
		return {
			discoveries: parseDiscoveries(this.readUnknown(STORAGE_KEYS.discoveries)),
			daily: parseDailyProgress(this.readUnknown(STORAGE_KEYS.daily)),
			personalBests: parsePersonalBests(this.readUnknown(STORAGE_KEYS.personalBests))
		};
	}
	saveDiscoveries(discoveries) {
		const values = [...discoveries].sort((left, right) => left - right);
		try {
			if (!this.storage) return false;
			if (values.length) this.storage.setItem(STORAGE_KEYS.discoveries, JSON.stringify(values));
			else this.storage.removeItem(STORAGE_KEYS.discoveries);
			return true;
		} catch {
			return false;
		}
	}
	clearProgress() {
		try {
			if (!this.storage) return false;
			this.storage.removeItem(STORAGE_KEYS.discoveries);
			this.storage.removeItem(STORAGE_KEYS.daily);
			this.storage.removeItem(STORAGE_KEYS.personalBests);
			return true;
		} catch {
			return false;
		}
	}
	saveDaily(progress) {
		return this.write(STORAGE_KEYS.daily, progress);
	}
	savePersonalBests(bests) {
		return this.write(STORAGE_KEYS.personalBests, bests);
	}
	readUnknown(key) {
		try {
			if (!this.storage) return void 0;
			const value = this.storage.getItem(key);
			return value === null ? void 0 : JSON.parse(value);
		} catch {
			return;
		}
	}
	write(key, value) {
		try {
			if (!this.storage) return false;
			this.storage.setItem(key, JSON.stringify(value));
			return true;
		} catch {
			return false;
		}
	}
};
//#endregion
//#region src/platform/volume-settings-repository.ts
var VOLUME_STORAGE_KEY = "corzaguessr:volume";
var LocalStorageVolumeSettingsRepository = class {
	storage;
	constructor(storage = browserStorage()) {
		this.storage = storage;
	}
	load() {
		try {
			if (!this.storage) return 100;
			const raw = this.storage.getItem(VOLUME_STORAGE_KEY);
			if (raw === null) return 100;
			const value = JSON.parse(raw);
			return isVolume(value) ? value : 100;
		} catch {
			return 100;
		}
	}
	save(volume) {
		if (!isVolume(volume)) return false;
		try {
			if (!this.storage) return false;
			this.storage.setItem(VOLUME_STORAGE_KEY, JSON.stringify(volume));
			return true;
		} catch {
			return false;
		}
	}
};
function isVolume(value) {
	return Number.isSafeInteger(value) && Number(value) >= 0 && Number(value) <= 100;
}
function browserStorage() {
	try {
		return window.localStorage;
	} catch {
		return null;
	}
}
//#endregion
//#region src/playback/dual-slot-audio-player.ts
var browserTiming = {
	setTimeout: (callback, delayMs) => window.setTimeout(callback, delayMs),
	clearTimeout: (handle) => window.clearTimeout(handle)
};
/**
* The only module that touches HTMLAudioElement. Slot and play generations make
* callbacks from released sources and superseded play promises harmless.
*/
var DualSlotAudioPlayer = class {
	sourceForRound;
	callbacks;
	timing;
	playbackTimeoutMs;
	slots;
	active = null;
	standby = null;
	generation = 0;
	lastActiveSlotId = null;
	status = "empty";
	suspension = null;
	operation = null;
	watchdogOwner = null;
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
			role: "empty",
			generation: 0,
			playGeneration: 0,
			controller: null,
			failed: false,
			ready: false,
			playRequested: false,
			hasRequestedPlayback: false
		}));
	}
	setVolume(volume) {
		this.volume = Math.min(1, Math.max(0, Number.isFinite(volume) ? volume : 1));
		for (const slot of this.slots) slot.element.volume = this.volume;
	}
	prepare(round) {
		return this.assign(round, "active");
	}
	preload(round) {
		return this.assign(round, "standby");
	}
	promote(round) {
		const slot = this.standby;
		if (!slot || slot.round?.id !== round.id) {
			this.callbacks.onFailure({
				role: "standby",
				stage: "standby-promotion",
				round,
				generation: slot?.generation ?? this.generation,
				error: /* @__PURE__ */ new Error("Prepared audio is unavailable.")
			});
			return false;
		}
		const mediaError = slot.element.error;
		if (slot.failed || mediaError) {
			this.standby = null;
			const failure = {
				role: "standby",
				stage: "standby-promotion",
				round,
				generation: slot.generation,
				error: mediaErrorToError(mediaError, "Prepared audio failed before promotion.")
			};
			slot.failed = true;
			this.releaseSlot(slot);
			this.emitFailure(failure);
			return false;
		}
		this.cancelPlaybackWatchdog();
		const previous = this.active;
		this.active = slot;
		this.standby = null;
		slot.role = "active";
		slot.playGeneration += 1;
		slot.playRequested = false;
		slot.hasRequestedPlayback = false;
		this.operation = null;
		this.status = slot.ready ? "ready" : "loading";
		if (previous && previous !== slot) {
			this.lastActiveSlotId = previous.id;
			this.releaseSlot(previous);
		}
		return true;
	}
	playPrepared(round, restart) {
		const slot = this.active;
		if (!slot || slot.round?.id !== round.id || slot.failed || this.suspension) return false;
		const operation = {
			slotId: slot.id,
			slotGeneration: slot.generation,
			roundId: round.id,
			playGeneration: ++slot.playGeneration
		};
		slot.playRequested = true;
		slot.hasRequestedPlayback = true;
		this.operation = operation;
		if (restart) {
			slot.element.pause();
			this.seek(slot);
		} else this.correctLateSeek(slot);
		this.status = "starting";
		let playPromise;
		try {
			playPromise = slot.element.play();
		} catch (error) {
			if (this.isCurrentPlaybackOperation(slot, operation)) this.fail(slot, "active", "active-playback", normalizeError(error));
			return false;
		}
		if (this.isCurrentPlaybackOperation(slot, operation)) this.startPlaybackWatchdog(slot, operation);
		playPromise?.catch((error) => {
			if (!this.isCurrentPlaybackOperation(slot, operation)) return;
			if (isNamedError(error, "AbortError")) return;
			if (isNamedError(error, "NotAllowedError")) {
				this.cancelPlaybackWatchdog(operation);
				slot.playRequested = false;
				this.operation = null;
				this.status = "blocked";
				this.callbacks.onBlocked(round);
				return;
			}
			this.fail(slot, "active", "active-playback", normalizeError(error));
		});
		return true;
	}
	pause() {
		this.cancelPlaybackWatchdog();
		this.operation = null;
		const active = this.active;
		if (!active) return;
		active.playGeneration += 1;
		active.playRequested = false;
		this.status = "paused";
		active.element.pause();
	}
	releaseActive() {
		this.cancelPlaybackWatchdog();
		this.operation = null;
		if (!this.active) return;
		const slot = this.active;
		this.lastActiveSlotId = slot.id;
		this.active = null;
		this.suspension = null;
		this.releaseSlot(slot);
		this.status = this.standby ? "paused" : "empty";
	}
	stop() {
		this.cancelPlaybackWatchdog();
		this.operation = null;
		this.generation += 1;
		this.suspension = null;
		if (this.active) {
			const active = this.active;
			this.active = null;
			this.lastActiveSlotId = active.id;
			this.releaseSlot(active);
		}
		this.discardStandby();
		this.status = "empty";
	}
	discardStandby() {
		if (!this.standby) return;
		const standby = this.standby;
		this.standby = null;
		this.releaseSlot(standby);
	}
	suspend() {
		if (this.suspension) return;
		this.suspension = {
			terminal: null,
			standbyFailures: []
		};
		this.cancelPlaybackWatchdog();
		this.operation = null;
		for (const slot of this.slots) {
			if (slot.role === "empty") continue;
			slot.playGeneration += 1;
			slot.playRequested = false;
			slot.element.pause();
		}
		if (this.active) this.status = "paused";
	}
	restore() {
		const suspension = this.suspension;
		this.suspension = null;
		if (!suspension) return;
		for (const failure of suspension.standbyFailures) this.callbacks.onFailure(failure);
		if (suspension.terminal) this.callbacks.onFailure(suspension.terminal.failure);
		if (this.active?.ready && !this.active.failed && this.active.round) this.callbacks.onReady?.({
			role: "active",
			round: this.active.round,
			generation: this.active.generation
		});
		if (this.standby?.ready && !this.standby.failed && this.standby.round) this.callbacks.onReady?.({
			role: "standby",
			round: this.standby.round,
			generation: this.standby.generation
		});
	}
	snapshot() {
		return {
			status: this.status,
			generation: this.generation,
			activeRoundId: this.active?.round?.id ?? null,
			activeGeneration: this.active?.generation ?? null,
			activeReady: this.active?.ready ?? false,
			activePlayRequested: this.active?.playRequested ?? false,
			standbyRoundId: this.standby?.round?.id ?? null,
			standbyGeneration: this.standby?.generation ?? null,
			standbyReady: this.standby?.ready ?? false,
			suspended: this.suspension !== null
		};
	}
	assign(round, role) {
		if (role === "active") {
			this.cancelPlaybackWatchdog();
			this.operation = null;
		}
		const protectedSlot = role === "active" ? this.standby : this.active;
		const existing = role === "active" ? this.active : this.standby;
		if (existing?.round?.id === round.id && !existing.failed) return true;
		if (existing) {
			if (role === "active") this.active = null;
			else this.standby = null;
			this.releaseSlot(existing);
		}
		const candidates = this.slots.filter((slot) => slot !== protectedSlot);
		const slot = candidates.find((candidate) => candidate.id !== this.lastActiveSlotId) ?? candidates[0] ?? null;
		if (!slot) return false;
		if (slot.role !== "empty") this.releaseSlot(slot);
		slot.round = round;
		slot.role = role;
		slot.generation = ++this.generation;
		slot.playGeneration = 0;
		slot.failed = false;
		slot.ready = false;
		slot.playRequested = false;
		slot.hasRequestedPlayback = false;
		if (role === "active") {
			this.active = slot;
			this.status = "loading";
		} else this.standby = slot;
		this.bind(slot);
		slot.element.preload = "auto";
		slot.element.src = this.sourceForRound(round);
		slot.element.load();
		if (slot.element.error) {
			this.fail(slot, role, role === "active" ? "active-preload" : "standby-preload", mediaErrorToError(slot.element.error, "Audio failed while being staged."));
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
			if (!live() || slot !== this.active || !slot.playRequested || this.suspension) return;
			if (!this.operation || !this.isCurrentPlaybackOperation(slot, this.operation)) return;
			this.correctLateSeek(slot);
			this.cancelPlaybackWatchdog(this.operation);
			this.status = "playing";
			this.markReady(slot);
			this.callbacks.onPlaying(round);
		}, { signal: controller.signal });
		slot.element.addEventListener("timeupdate", () => {
			if (!live() || slot !== this.active || !slot.playRequested || this.suspension) return;
			this.correctLateSeek(slot);
		}, { signal: controller.signal });
		const wait = () => {
			if (!live() || slot !== this.active || !slot.playRequested || this.suspension) return;
			if (!this.operation || !this.isCurrentPlaybackOperation(slot, this.operation)) return;
			const wasPlaying = this.status === "playing";
			if (this.status === "buffering") return;
			this.status = "buffering";
			if (wasPlaying) this.startPlaybackWatchdog(slot, this.operation);
			this.callbacks.onWaiting(round);
		};
		slot.element.addEventListener("waiting", wait, { signal: controller.signal });
		slot.element.addEventListener("stalled", wait, { signal: controller.signal });
		slot.element.addEventListener("ended", () => {
			if (!live() || slot !== this.active || !slot.playRequested || this.suspension) return;
			const operation = this.operation;
			if (!operation || !this.isCurrentPlaybackOperation(slot, operation)) return;
			this.cancelPlaybackWatchdog(operation);
			this.operation = null;
			slot.playRequested = false;
			this.status = "ended";
			this.callbacks.onEnded(round);
		}, { signal: controller.signal });
		slot.element.addEventListener("error", () => {
			if (!live() || !slot.element.error) return;
			const currentRole = slot === this.standby ? "standby" : "active";
			const stage = currentRole === "standby" ? "standby-preload" : slot.hasRequestedPlayback ? "active-playback" : "active-preload";
			this.fail(slot, currentRole, stage, mediaErrorToError(slot.element.error, "Audio element reported an error."));
		}, { signal: controller.signal });
	}
	markReady(slot) {
		if (slot.ready || slot.failed || !slot.round) return;
		slot.ready = true;
		this.seek(slot);
		if (slot === this.active && this.status === "loading") this.status = "ready";
		if (!this.suspension) this.callbacks.onReady?.({
			role: slot === this.standby ? "standby" : "active",
			round: slot.round,
			generation: slot.generation
		});
	}
	fail(slot, role, stage, error) {
		if (slot.failed || !slot.round) return;
		slot.failed = true;
		slot.playGeneration += 1;
		slot.playRequested = false;
		const failure = {
			role,
			stage,
			round: slot.round,
			generation: slot.generation,
			error
		};
		if (role === "standby") {
			if (this.standby === slot) this.standby = null;
			this.releaseSlot(slot);
			this.emitFailure(failure);
			return;
		}
		this.cancelPlaybackWatchdog();
		this.operation = null;
		this.status = "failed";
		this.emitFailure(failure);
	}
	emitFailure(failure) {
		if (!this.suspension) {
			this.callbacks.onFailure(failure);
			return;
		}
		if (failure.role === "standby") this.suspension.standbyFailures.push(failure);
		else this.suspension.terminal = {
			type: "failed",
			failure
		};
	}
	startPlaybackWatchdog(slot, operation) {
		this.cancelPlaybackWatchdog();
		this.watchdogOwner = operation;
		this.watchdogTimer = this.timing.setTimeout(() => {
			if (!samePlaybackOperation(this.watchdogOwner, operation) || !this.isCurrentPlaybackOperation(slot, operation) || !["starting", "buffering"].includes(this.status)) return;
			this.watchdogTimer = 0;
			this.watchdogOwner = null;
			this.fail(slot, "active", "active-playback", /* @__PURE__ */ new Error(`Audio playback did not start within ${this.playbackTimeoutMs} ms.`));
		}, this.playbackTimeoutMs);
	}
	cancelPlaybackWatchdog(operation) {
		if (operation && !samePlaybackOperation(this.watchdogOwner, operation)) return;
		if (this.watchdogTimer) this.timing.clearTimeout(this.watchdogTimer);
		this.watchdogTimer = 0;
		this.watchdogOwner = null;
	}
	seek(slot) {
		if (!slot.round || slot.element.readyState < HTMLMediaElement.HAVE_METADATA || slot.element.seeking) return;
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
		return slot.generation === generation && slot.role !== "empty" && slot.round?.id === roundId;
	}
	isCurrentPlaybackOperation(slot, operation) {
		return slot === this.active && slot.id === operation.slotId && slot.playGeneration === operation.playGeneration && samePlaybackOperation(this.operation, operation) && this.isLive(slot, operation.slotGeneration, operation.roundId);
	}
	releaseSlot(slot) {
		const replaceFailedElement = slot.failed;
		slot.playGeneration += 1;
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
		slot.role = "empty";
		slot.failed = false;
		slot.ready = false;
		slot.playRequested = false;
		slot.hasRequestedPlayback = false;
	}
};
function normalizeError(error) {
	return error instanceof Error ? error : new Error(String(error));
}
function mediaErrorToError(error, fallback) {
	if (!error) return new Error(fallback);
	const descriptions = {
		[MediaError.MEDIA_ERR_ABORTED]: "Audio loading was aborted.",
		[MediaError.MEDIA_ERR_NETWORK]: "A network error interrupted audio loading.",
		[MediaError.MEDIA_ERR_DECODE]: "The audio file could not be decoded.",
		[MediaError.MEDIA_ERR_SRC_NOT_SUPPORTED]: "The audio source is not supported."
	};
	return new Error(descriptions[error.code] ?? error.message ?? fallback);
}
function isNamedError(error, name) {
	return typeof error === "object" && error !== null && "name" in error && error.name === name;
}
function samePlaybackOperation(left, right) {
	return Boolean(left && left.slotId === right.slotId && left.slotGeneration === right.slotGeneration && left.roundId === right.roundId && left.playGeneration === right.playGeneration);
}
//#endregion
//#region src/playback/playback-coordinator.ts
var browserScheduler = {
	setTimeout: (callback, delayMs) => window.setTimeout(callback, delayMs),
	clearTimeout: (handle) => window.clearTimeout(handle),
	queueMicrotask: (callback) => globalThis.queueMicrotask(callback)
};
var MAXIMUM_AUTOMATIC_RECOVERIES = 2;
var MAXIMUM_STANDBY_RECOVERIES = 2;
/**
* Owns round transport, grace notices, prefetch, and recovery. It deliberately
* leaves HTMLMediaElement details to AudioPlayer and game state to GameSession.
*/
var PlaybackCoordinator = class {
	audio;
	callbacks;
	scheduler;
	loadingGraceMs;
	prepared = null;
	pending = null;
	standby = null;
	active = null;
	retryRound = null;
	promotionCandidate = null;
	mode = null;
	factory = null;
	previousTrackId = null;
	failedTrackIds = /* @__PURE__ */ new Set();
	heardClassicRoundId = null;
	activeRecoveryAttempts = 0;
	standbyRecoveryAttempts = 0;
	automaticRecoveryBlocked = false;
	standbyRecoveryBlocked = false;
	status = "empty";
	suspended = false;
	statusBeforeSuspend = "empty";
	operationGeneration = 0;
	lifecycleGeneration = 0;
	loadingTimer = 0;
	loadingOwner = null;
	loadingVisible = false;
	restoringFromSuspension = false;
	constructor(audio, callbacks, scheduler = browserScheduler, loadingGraceMs = 1e3) {
		this.audio = audio;
		this.callbacks = callbacks;
		this.scheduler = scheduler;
		this.loadingGraceMs = loadingGraceMs;
	}
	get ownedRound() {
		return this.active ?? this.pending ?? this.prepared ?? this.retryRound;
	}
	get snapshot() {
		const audio = this.audio.snapshot();
		return {
			status: this.status,
			generation: this.operationGeneration,
			mode: this.mode,
			preparedRoundId: this.prepared?.id ?? null,
			pendingRoundId: this.pending?.id ?? null,
			activeRoundId: this.active?.id ?? null,
			standbyRoundId: this.standby?.id ?? null,
			retryRoundId: this.retryRound?.id ?? null,
			loading: this.loadingSignal(this.loadingVisible),
			suspended: this.suspended,
			activeRecoveryAttempts: this.activeRecoveryAttempts,
			standbyRecoveryAttempts: this.standbyRecoveryAttempts,
			automaticRecoveryBlocked: this.automaticRecoveryBlocked,
			standbyRecoveryBlocked: this.standbyRecoveryBlocked,
			audio
		};
	}
	configure(mode, factory) {
		const changingMode = this.mode !== mode;
		this.stop();
		this.mode = mode;
		this.factory = factory;
		if (changingMode) this.previousTrackId = null;
		this.failedTrackIds.clear();
		this.heardClassicRoundId = null;
		this.resetRecoveryCircuits();
	}
	prime() {
		if (!this.mode || !this.factory || this.suspended || this.prepared || this.pending || this.active || this.retryRound) return;
		const round = this.factory(this.failedTrackIds, this.previousTrackId);
		if (!round) return;
		this.prepared = round;
		this.status = "prepared";
		if (!this.audio.prepare(round) && this.prepared?.id === round.id) this.handleRejected(round, "active-preload", "Audio could not be staged before Play.");
	}
	start(options = {}) {
		if (!this.mode || !this.factory || this.suspended) return false;
		if (options.manualRetry) {
			this.resetRecoveryCircuits();
			if (!this.retryRound) this.failedTrackIds.clear();
		}
		if (!options.manualRetry && this.automaticRecoveryBlocked) {
			this.callbacks.onRecovery("manual-retry");
			return false;
		}
		let round = null;
		if (this.retryRound) {
			round = this.retryRound;
			this.retryRound = null;
			this.prepared = round;
			this.status = "prepared";
			if (!this.audio.prepare(round)) {
				if (this.prepared?.id === round.id) this.handleRejected(round, "active-preload", "Audio could not be staged for retry.");
				return false;
			}
			this.prepared = null;
		} else if (this.prepared) {
			round = this.prepared;
			this.prepared = null;
		} else if (this.standby) {
			round = this.standby;
			this.promotionCandidate = round;
			if (!this.audio.promote(round)) {
				if (this.promotionCandidate?.id === round.id) this.handleRejected(round, "standby-promotion", "Prepared standby audio could not be promoted.", "standby");
				this.promotionCandidate = null;
				return false;
			}
			this.promotionCandidate = null;
			this.standby = null;
		} else {
			round = this.factory(this.failedTrackIds, this.previousTrackId);
			if (!round) {
				this.status = "retry";
				this.callbacks.onRecovery("manual-retry");
				return false;
			}
			this.prepared = round;
			this.status = "prepared";
			if (!this.audio.prepare(round)) {
				if (this.prepared?.id === round.id) this.handleRejected(round, "active-preload", "Audio could not be staged.");
				return false;
			}
			this.prepared = null;
		}
		this.active = null;
		this.pending = round;
		this.status = "starting";
		const operation = ++this.operationGeneration;
		this.cancelLoadingTimerOnly();
		if (!this.audio.playPrepared(round, false)) {
			if (this.pending?.id === round.id) this.handleRejected(round, "active-playback", "Audio could not start.");
			return false;
		}
		if (this.pending?.id !== round.id || operation !== this.operationGeneration) return true;
		this.clearLoading();
		this.callbacks.onPending(round);
		this.beginLoadingNotice(round, "starting", operation);
		if (this.audio.snapshot().activeReady) this.prefetch();
		return true;
	}
	replay(round, restart) {
		if (this.suspended || !this.owns(round)) return false;
		this.status = "starting";
		const operation = ++this.operationGeneration;
		this.cancelLoadingTimerOnly();
		if (!this.audio.playPrepared(round, restart)) {
			if (this.owns(round)) this.handleRejected(round, "active-playback", "Prepared audio could not restart.");
			return false;
		}
		if (operation !== this.operationGeneration || !this.owns(round)) return true;
		this.clearLoading();
		this.beginLoadingNotice(round, "starting", operation);
		if (this.audio.snapshot().activeReady) this.prefetch();
		return true;
	}
	pause() {
		this.operationGeneration += 1;
		this.clearLoading();
		this.audio.pause();
		if (this.ownedRound) this.status = "paused";
	}
	suspend() {
		if (this.suspended) return;
		this.statusBeforeSuspend = this.status;
		this.suspended = true;
		this.status = "suspended";
		this.operationGeneration += 1;
		this.clearLoading();
		this.audio.suspend();
	}
	restore() {
		if (!this.suspended) return;
		this.suspended = false;
		this.status = this.prepared ? "prepared" : this.retryRound ? "retry" : this.pending || this.active ? "paused" : this.statusBeforeSuspend === "empty" ? "empty" : "paused";
		this.restoringFromSuspension = true;
		try {
			this.audio.restore();
		} finally {
			this.restoringFromSuspension = false;
		}
	}
	stop() {
		this.lifecycleGeneration += 1;
		this.operationGeneration += 1;
		this.clearLoading();
		this.audio.stop();
		this.prepared = null;
		this.pending = null;
		this.standby = null;
		this.active = null;
		this.retryRound = null;
		this.promotionCandidate = null;
		this.suspended = false;
		this.status = "empty";
	}
	reset() {
		this.stop();
		this.mode = null;
		this.factory = null;
		this.previousTrackId = null;
		this.failedTrackIds.clear();
		this.heardClassicRoundId = null;
		this.resetRecoveryCircuits();
	}
	handleReady(event) {
		if (this.suspended) return;
		const audio = this.audio.snapshot();
		if (event.role === "active") {
			if (audio.activeRoundId !== event.round.id || audio.activeGeneration !== event.generation || !this.owns(event.round)) return;
			this.prefetch();
			return;
		}
		if (this.standby?.id !== event.round.id || audio.standbyRoundId !== event.round.id || audio.standbyGeneration !== event.generation) return;
		this.standbyRecoveryAttempts = 0;
		this.standbyRecoveryBlocked = false;
	}
	handlePlaying(round) {
		if (this.suspended) return;
		if (this.pending?.id === round.id) {
			this.pending = null;
			this.active = round;
			this.retryRound = null;
			this.status = "playing";
			if (this.mode === "classic") this.heardClassicRoundId = round.id;
			this.previousTrackId = this.mode === "daily" ? this.previousTrackId : round.track.dailyNumber;
			this.resetActiveRecovery();
			this.clearLoading();
			this.callbacks.onPlaying(round, true);
			this.prefetch();
			return;
		}
		if (this.active?.id === round.id) {
			this.status = "playing";
			if (this.mode === "classic") this.heardClassicRoundId = round.id;
			this.resetActiveRecovery();
			this.clearLoading();
			this.callbacks.onPlaying(round, false);
			this.prefetch();
		}
	}
	handleWaiting(round) {
		if (this.suspended || !this.owns(round)) return;
		const alreadyWaiting = this.status === "waiting";
		this.status = "waiting";
		if (this.loadingOwner?.roundId === round.id && this.loadingOwner.generation === this.operationGeneration) this.loadingOwner.stage = "waiting";
		else if (!alreadyWaiting) this.beginLoadingNotice(round, "waiting", this.operationGeneration);
		this.callbacks.onWaiting(round);
	}
	handleBlocked(round) {
		if (this.suspended || !this.owns(round)) return;
		this.status = "blocked";
		this.clearLoading();
		this.callbacks.onBlocked(round);
	}
	handleEnded(round) {
		if (this.suspended || this.active?.id !== round.id) return;
		this.status = "ended";
		this.clearLoading();
		this.callbacks.onEnded(round);
	}
	handleFailure(failure) {
		if (this.suspended) return;
		if (failure.stage === "standby-promotion" && this.promotionCandidate?.id === failure.round.id) {
			this.standby = null;
			this.promotionCandidate = null;
			this.handleActiveFailure(failure, true);
			return;
		}
		if (failure.role === "standby") {
			if (this.standby?.id !== failure.round.id) return;
			this.standby = null;
			if (this.mode && MODE_RULES[this.mode].failurePolicy !== "fixed") this.failedTrackIds.add(failure.round.track.dailyNumber);
			if (this.standbyRecoveryAttempts < MAXIMUM_STANDBY_RECOVERIES) {
				this.standbyRecoveryAttempts += 1;
				this.defer(() => this.prefetch());
			} else this.standbyRecoveryBlocked = true;
			return;
		}
		if (!this.owns(failure.round)) return;
		this.handleActiveFailure(failure, false, this.restoringFromSuspension);
	}
	handleActiveFailure(failure, promotionFailure, requireExplicitPlay = false) {
		const round = failure.round;
		const wasPrepared = this.prepared?.id === round.id;
		const shouldResume = promotionFailure || this.pending?.id === round.id || [
			"starting",
			"playing",
			"waiting"
		].includes(this.status);
		const failurePolicy = this.mode ? MODE_RULES[this.mode].failurePolicy : "replace";
		const preserveIdentity = failurePolicy === "fixed" || failurePolicy === "heard-fixed" && this.heardClassicRoundId === round.id;
		this.operationGeneration += 1;
		this.clearLoading();
		if (failurePolicy !== "fixed") this.failedTrackIds.add(round.track.dailyNumber);
		this.prepared = null;
		this.pending = null;
		this.active = null;
		this.promotionCandidate = null;
		this.audio.releaseActive();
		if (requireExplicitPlay) {
			this.automaticRecoveryBlocked = true;
			this.retryRound = round;
			this.status = "retry";
			this.callbacks.onRecovery("selected-track-retry");
			return;
		}
		if (!preserveIdentity && this.activeRecoveryAttempts < MAXIMUM_AUTOMATIC_RECOVERIES) {
			this.activeRecoveryAttempts += 1;
			this.status = "empty";
			if (wasPrepared || !shouldResume) this.defer(() => this.prime());
			else {
				this.callbacks.onRecovery("automatic-replacement");
				this.defer(() => this.start());
			}
			return;
		}
		this.automaticRecoveryBlocked = true;
		this.retryRound = round;
		this.status = "retry";
		this.callbacks.onRecovery("selected-track-retry");
	}
	prefetch() {
		if (!isTimedMode(this.mode) || !this.factory || this.suspended || this.standby || this.standbyRecoveryBlocked) return;
		const owned = this.active ?? this.pending ?? this.prepared;
		const audio = this.audio.snapshot();
		if (!owned || audio.activeRoundId !== owned.id || !audio.activeReady) return;
		const round = this.factory(this.failedTrackIds, owned.track.dailyNumber);
		if (!round) return;
		this.standby = round;
		if (!this.audio.preload(round) && this.standby?.id === round.id) this.handleRejected(round, "standby-preload", "Standby audio could not be staged.", "standby");
	}
	owns(round) {
		return [
			this.prepared,
			this.pending,
			this.active,
			this.retryRound
		].some((item) => item?.id === round.id);
	}
	handleRejected(round, stage, message, role = "active") {
		this.handleFailure({
			role,
			stage,
			round,
			generation: role === "standby" ? this.audio.snapshot().standbyGeneration ?? 0 : this.audio.snapshot().activeGeneration ?? 0,
			error: new Error(message)
		});
	}
	resetRecoveryCircuits() {
		this.resetActiveRecovery();
		this.standbyRecoveryAttempts = 0;
		this.standbyRecoveryBlocked = false;
	}
	resetActiveRecovery() {
		this.activeRecoveryAttempts = 0;
		this.automaticRecoveryBlocked = false;
	}
	defer(callback) {
		const lifecycle = this.lifecycleGeneration;
		this.scheduler.queueMicrotask(() => {
			if (lifecycle === this.lifecycleGeneration && !this.suspended) callback();
		});
	}
	beginLoadingNotice(round, stage, generation) {
		this.cancelLoadingTimerOnly();
		this.loadingOwner = {
			roundId: round.id,
			stage,
			generation
		};
		this.loadingTimer = this.scheduler.setTimeout(() => {
			this.loadingTimer = 0;
			const owner = this.loadingOwner;
			if (!owner || owner.roundId !== round.id || owner.generation !== generation || generation !== this.operationGeneration || !this.owns(round) || !["starting", "waiting"].includes(this.status)) return;
			this.loadingVisible = true;
			const signal = this.loadingSignal(true);
			this.callbacks.onLoading(true, signal);
		}, this.loadingGraceMs);
	}
	clearLoading() {
		this.cancelLoadingTimerOnly();
		if (this.loadingVisible) {
			this.loadingVisible = false;
			this.callbacks.onLoading(false, this.loadingSignal(false));
		}
		this.loadingOwner = null;
	}
	cancelLoadingTimerOnly() {
		if (this.loadingTimer) this.scheduler.clearTimeout(this.loadingTimer);
		this.loadingTimer = 0;
	}
	loadingSignal(visible) {
		return {
			visible,
			roundId: this.loadingOwner?.roundId ?? null,
			stage: this.loadingOwner?.stage ?? null,
			operationGeneration: this.loadingOwner?.generation ?? this.operationGeneration
		};
	}
};
//#endregion
//#region src/ui/motion-scheduler.ts
var browserUiScheduler = {
	requestFrame: (callback) => window.requestAnimationFrame(callback),
	cancelFrame: (handle) => window.cancelAnimationFrame(handle),
	setTimer: (callback, delayMs) => window.setTimeout(callback, delayMs),
	clearTimer: (handle) => window.clearTimeout(handle)
};
//#endregion
//#region src/ui/attempt-history-view.ts
var AttemptHistoryView = class {
	elements;
	durations;
	reducedMotion;
	scheduler;
	renderedHistory = [];
	currentSignature = "";
	sessionKey = "";
	renderGeneration = 0;
	nodeMotionGeneration = 0;
	fadeGenerations = /* @__PURE__ */ new WeakMap();
	collapseTimer = 0;
	collapseListener = null;
	collapseTarget = null;
	pendingSnapshot = null;
	wiggles = /* @__PURE__ */ new Map();
	constructor(elements, durations, reducedMotion, scheduler = browserUiScheduler) {
		this.elements = elements;
		this.durations = durations;
		this.reducedMotion = reducedMotion;
		this.scheduler = scheduler;
	}
	render(current, history, sessionKey) {
		const snapshot = {
			current,
			history: [...history],
			sessionKey
		};
		if (this.pendingSnapshot) {
			this.pendingSnapshot = snapshot;
			return;
		}
		if (this.sessionKey !== "" && sessionKey !== this.sessionKey && this.hasRenderedAttempts()) {
			this.pendingSnapshot = snapshot;
			this.collapseAttempts();
			return;
		}
		this.applySnapshot(snapshot);
	}
	applySnapshot(snapshot) {
		this.sessionKey = snapshot.sessionKey;
		this.renderCurrent(snapshot.current, snapshot.sessionKey);
		this.renderHistory(snapshot.history, snapshot.sessionKey);
	}
	renderHistory(entries, sessionKey) {
		const rendered = entries.map((entry) => ({
			key: `${sessionKey}:${entry.id}`,
			text: entry.text,
			tone: entry.tone,
			speedrunMilestone: entry.speedrunMilestone === true
		}));
		if (rendered.length === this.renderedHistory.length && rendered.every((entry, index) => {
			const previous = this.renderedHistory[index];
			return previous?.key === entry.key && previous.text === entry.text && previous.tone === entry.tone && previous.speedrunMilestone === entry.speedrunMilestone;
		})) return;
		this.renderedHistory = rendered;
		this.renderGeneration += 1;
		this.cancelCollapse();
		if (!rendered.length) {
			this.collapseHistory();
			return;
		}
		const existing = new Map([...this.elements.history.children].map((child) => {
			const element = child;
			return [element.dataset.historyKey ?? "", element];
		}));
		const fadeNodes = [];
		const wiggleNodes = [];
		const nodes = rendered.map((entry) => {
			let element = existing.get(entry.key);
			const isNew = !element;
			if (!element) {
				element = document.createElement("div");
				element.className = "slot fade";
				element.dataset.historyKey = entry.key;
			}
			existing.delete(entry.key);
			const previousTone = element.dataset.tone ?? "";
			this.applyTone(element, previousTone, entry.tone);
			element.textContent = entry.text;
			this.applySpeedrunMilestone(element, entry.speedrunMilestone === true, entry.text);
			if (/^(wrong|skip)$/.test(entry.tone) && (isNew || previousTone !== entry.tone)) wiggleNodes.push(element);
			if (isNew) fadeNodes.push(element);
			return element;
		});
		for (const removed of existing.values()) this.cancelWiggle(removed);
		this.elements.history.style.height = "";
		this.elements.history.replaceChildren(...nodes);
		for (const element of fadeNodes) this.fadeIn(element);
		for (const element of wiggleNodes) this.startWiggle(element);
	}
	renderCurrent(slot, sessionKey) {
		const signature = slot ? `${sessionKey}:${slot.id}|${slot.text}|${slot.tone}|${Number(slot.speedrunMilestone)}` : "";
		if (signature === this.currentSignature) return;
		this.currentSignature = signature;
		const element = this.elements.current;
		const previousTone = element.dataset.tone ?? "";
		this.applyTone(element, previousTone, slot?.tone ?? "");
		if (!slot) {
			this.fadeGenerations.delete(element);
			this.cancelWiggle(element);
			element.classList.remove("fade");
			element.dataset.currentKey = "";
			element.textContent = "";
			this.applySpeedrunMilestone(element, false, "");
			element.hidden = true;
			return;
		}
		element.dataset.currentKey = `${sessionKey}:${slot.id}`;
		element.textContent = slot.text;
		this.applySpeedrunMilestone(element, slot.speedrunMilestone === true, slot.text);
		element.hidden = false;
		this.fadeIn(element);
	}
	hasRenderedAttempts() {
		return !this.elements.current.hidden || this.elements.history.children.length > 0;
	}
	collapseAttempts() {
		const fading = [...!this.elements.current.hidden ? [this.elements.current] : [], ...[...this.elements.history.children]];
		this.startCollapse(this.elements.container, fading, this.durations.collapse(), () => {
			const pending = this.pendingSnapshot;
			this.pendingSnapshot = null;
			this.clearRenderedAttempts();
			if (pending) this.applySnapshot(pending);
		});
	}
	collapseHistory() {
		const container = this.elements.history;
		if (!container.children.length) {
			container.style.height = "";
			return;
		}
		this.startCollapse(container, [...container.children], this.durations.collapse(), () => this.finishHistoryCollapse());
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
		const finish = () => {
			if (generation !== this.renderGeneration) return;
			this.cancelCollapse(false);
			onFinished();
		};
		this.collapseTarget = container;
		this.collapseListener = (event) => {
			const transition = event;
			if (event.target === container && (!transition.propertyName || transition.propertyName === "height")) finish();
		};
		container.addEventListener("transitionend", this.collapseListener);
		this.collapseTimer = this.scheduler.setTimer(finish, duration);
	}
	finishHistoryCollapse() {
		for (const child of this.elements.history.children) this.cancelWiggle(child);
		this.elements.history.replaceChildren();
		this.elements.history.style.height = "";
	}
	cancelCollapse(resetHeight = true) {
		if (this.collapseTimer) this.scheduler.clearTimer(this.collapseTimer);
		this.collapseTimer = 0;
		if (this.collapseListener && this.collapseTarget) this.collapseTarget.removeEventListener("transitionend", this.collapseListener);
		this.collapseListener = null;
		if (resetHeight && this.collapseTarget) this.collapseTarget.style.height = "";
		this.collapseTarget = null;
	}
	clearRenderedAttempts() {
		this.renderedHistory = [];
		this.currentSignature = "";
		this.renderGeneration += 1;
		this.fadeGenerations.delete(this.elements.current);
		this.cancelWiggle(this.elements.current);
		for (const child of this.elements.history.children) this.cancelWiggle(child);
		this.applyTone(this.elements.current, this.elements.current.dataset.tone ?? "", "");
		this.elements.current.classList.remove("fade", "wiggle");
		this.applySpeedrunMilestone(this.elements.current, false, "");
		this.elements.current.dataset.currentKey = "";
		this.elements.current.textContent = "";
		this.elements.current.hidden = true;
		this.elements.container.style.height = "";
		this.elements.history.replaceChildren();
		this.elements.history.style.height = "";
	}
	applyTone(element, previous, next) {
		if (previous === next) return;
		element.classList.remove(...toneClasses(previous));
		element.classList.add(...toneClasses(next));
		element.dataset.tone = next;
	}
	applySpeedrunMilestone(element, speedrunMilestone, text) {
		element.classList.toggle("speedrun-milestone", speedrunMilestone);
		if (speedrunMilestone) element.setAttribute("aria-label", `${text}. Counts toward Speedrun completion.`);
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
//#endregion
//#region src/ui/track-search.ts
var TOKEN_ALIASES = {
	featuring: "feat",
	feat: "feat",
	ft: "feat",
	versus: "vs",
	vs: "vs",
	and: "and"
};
function normalizeTrackSearch(value) {
	return value.normalize("NFKD").replace(/\p{M}/gu, "").toLocaleLowerCase().replace(/[’'‘`]/gu, "").replace(/&/gu, " and ").replace(/[^\p{L}\p{N}]+/gu, " ").trim().split(/\s+/u).filter(Boolean).map((word) => TOKEN_ALIASES[word] ?? word).join(" ");
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
//#endregion
//#region src/ui/autocomplete.ts
var Autocomplete = class {
	input;
	list;
	onGuess;
	onPlaybackShortcut;
	tracks = [];
	searchIndex = [];
	unavailable = /* @__PURE__ */ new Set();
	suggestions = [];
	selectedIndex = -1;
	unavailableSignature = "";
	constructor(input, list, onGuess, onPlaybackShortcut) {
		this.input = input;
		this.list = list;
		this.onGuess = onGuess;
		this.onPlaybackShortcut = onPlaybackShortcut;
		input.addEventListener("input", () => this.update());
		input.addEventListener("keydown", (event) => this.handleKeydown(event));
		list.addEventListener("pointerover", (event) => {
			const option = event.target instanceof Element ? event.target.closest("[role=option]") : null;
			if (!option) return;
			const index = [...this.list.children].indexOf(option);
			if (index >= 0) this.select(index);
		});
		list.addEventListener("click", (event) => {
			const option = event.target instanceof Element ? event.target.closest("[role=option]") : null;
			if (!option) return;
			const track = this.suggestions[[...this.list.children].indexOf(option)];
			if (track) this.onGuess(track.dailyNumber);
		});
	}
	setDependencies(tracks, unavailable) {
		const unavailableSignature = [...unavailable].sort((left, right) => left - right).join(",");
		if (tracks === this.tracks && unavailableSignature === this.unavailableSignature) return;
		const selectedId = this.suggestions[this.selectedIndex]?.dailyNumber ?? null;
		this.tracks = tracks;
		this.searchIndex = createTrackSearchIndex(tracks);
		this.unavailableSignature = unavailableSignature;
		this.unavailable = new Set(unavailable);
		if (this.input.value.trim()) this.update(selectedId);
	}
	reset() {
		this.input.value = "";
		this.suggestions = [];
		this.selectedIndex = -1;
		this.render();
	}
	update(selectedId = null) {
		this.suggestions = searchTrackIndex(this.searchIndex, this.input.value, this.unavailable);
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
//#endregion
//#region src/ui/date-format.ts
var MONTHS = [
	"JANUARY",
	"FEBRUARY",
	"MARCH",
	"APRIL",
	"MAY",
	"JUNE",
	"JULY",
	"AUGUST",
	"SEPTEMBER",
	"OCTOBER",
	"NOVEMBER",
	"DECEMBER"
];
function formatOrdinalDate(value) {
	const [, year, month, day] = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value) ?? [];
	const monthName = month ? MONTHS[Number(month) - 1] : void 0;
	if (!year || !monthName || !day) return value;
	const numericDay = Number(day);
	const remainder = numericDay % 100;
	return `${monthName} ${numericDay}${remainder >= 11 && remainder <= 13 ? "TH" : numericDay % 10 === 1 ? "ST" : numericDay % 10 === 2 ? "ND" : numericDay % 10 === 3 ? "RD" : "TH"}, ${year}`;
}
//#endregion
//#region src/ui/discovery-list-view.ts
var formatReleaseDate = formatOrdinalDate;
var DiscoveryListView = class {
	count;
	items;
	coverUrl;
	expandedTrackId = null;
	openSpotify = null;
	startSpeedrun = null;
	tracks = null;
	discoveriesSignature = "";
	constructor(count, items, coverUrl) {
		this.count = count;
		this.items = items;
		this.coverUrl = coverUrl;
	}
	bind(openSpotify, startSpeedrun) {
		this.openSpotify = openSpotify;
		this.startSpeedrun = startSpeedrun;
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
			const speedrun = document.createElement("button");
			speedrun.type = "button";
			speedrun.className = "discovery-speedrun";
			speedrun.textContent = "✦";
			speedrun.tabIndex = -1;
			speedrun.setAttribute("aria-label", "START SPEEDRUN");
			speedrun.addEventListener("pointerdown", (event) => event.preventDefault());
			speedrun.addEventListener("focus", () => speedrun.blur());
			speedrun.addEventListener("click", () => this.startSpeedrun?.());
			this.count.append(speedrun);
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
		image.src = this.coverUrl(track.dailyNumber);
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
		const top = item.offsetTop;
		const bottom = top + item.offsetHeight;
		if (top < this.items.scrollTop) this.items.scrollTop = top;
		else if (bottom > this.items.scrollTop + this.items.clientHeight) this.items.scrollTop = bottom - this.items.clientHeight;
	}
};
function splitTrackTitle(value) {
	const separator = value.indexOf(" - ");
	return separator < 0 ? ["", value] : [value.slice(0, separator), value.slice(separator + 3)];
}
//#endregion
//#region src/ui/focus-navigation.ts
var MODES = [
	"daily",
	"classic",
	"blitz",
	"survival"
];
function nextPrimaryFocus(state, key) {
	const modeIndex = state.current && isMode(state.current) ? MODES.indexOf(state.current) : -1;
	if (modeIndex >= 0) {
		if (key === "ArrowUp") return available(state, "discovery");
		if (key === "ArrowDown") return available(state, "play");
		return modeInDirection(state, modeIndex, key === "ArrowLeft" ? -1 : 1);
	}
	const recommended = recommendedMode(state);
	if (state.current === "discovery") {
		if (key === "ArrowDown") return recommended;
		if (key === "ArrowLeft") return MODES.find((mode) => state.enabled.has(mode)) ?? null;
		if (key === "ArrowRight") return [...MODES].reverse().find((mode) => state.enabled.has(mode)) ?? null;
		return null;
	}
	if (state.current === "play") return key === "ArrowUp" ? recommended : null;
	return state.selectedMode && state.enabled.has("play") ? "play" : recommended;
}
function recommendedMode(state) {
	if (state.completedDaily && state.enabled.has("classic")) return "classic";
	if (!state.selectedMode && state.enabled.has("daily")) return "daily";
	const selectedIndex = state.selectedMode ? MODES.findIndex((mode) => mode === state.selectedMode) : -1;
	if (selectedIndex < 0) return MODES.find((mode) => state.enabled.has(mode)) ?? null;
	for (let distance = 1; distance < MODES.length; distance += 1) {
		const right = MODES[selectedIndex + distance];
		if (right && state.enabled.has(right)) return right;
		const left = MODES[selectedIndex - distance];
		if (left && state.enabled.has(left)) return left;
	}
	return MODES.find((mode) => state.enabled.has(mode)) ?? null;
}
function modeInDirection(state, start, step) {
	for (let distance = 1; distance < MODES.length; distance += 1) {
		const mode = MODES[(start + step * distance + MODES.length) % MODES.length];
		if (mode && state.enabled.has(mode)) return mode;
	}
	return null;
}
function available(state, target) {
	return state.enabled.has(target) ? target : null;
}
function isMode(target) {
	return target === "daily" || target === "blitz" || target === "classic" || target === "survival";
}
//#endregion
//#region src/ui/modal-controller.ts
var ModalController = class {
	root;
	elements;
	durations;
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
	scrollLockDepth = 0;
	lockedScroll = null;
	constructor(root, elements, durations, reducedMotion, announce, scheduler = browserUiScheduler) {
		this.root = root;
		this.elements = elements;
		this.durations = durations;
		this.reducedMotion = reducedMotion;
		this.announce = announce;
		this.scheduler = scheduler;
	}
	get openKind() {
		return this.kind;
	}
	get discoveryLayoutActive() {
		return this.kind === "discovery" && !this.closing;
	}
	openResult() {
		if (this.kind) return;
		const generation = this.beginOpen();
		this.kind = "result";
		this.closing = false;
		this.captureReturnFocus();
		this.lockScroll();
		this.elements.card.classList.add("modal-open");
		this.elements.result.setAttribute("aria-hidden", "false");
		const finishOpen = () => {
			this.openFrame = 0;
			if (!this.transitionMatches("result", generation)) return;
			this.elements.card.classList.add("modal-visible");
			this.elements.resultAction.focus({ preventScroll: true });
			this.announce(this.elements.resultMeta.dataset.announcement || "RESULT");
		};
		if (this.reducedMotion.matches) finishOpen();
		else this.openFrame = this.scheduler.requestFrame(finishOpen);
	}
	openDiscovery() {
		if (this.kind) return;
		const generation = this.beginOpen();
		this.kind = "discovery";
		this.closing = false;
		this.captureReturnFocus();
		this.lockScroll();
		this.root.classList.add("discovery-open");
		this.elements.discoveryModal.setAttribute("aria-hidden", "false");
		this.elements.discoveryButton.setAttribute("aria-expanded", "true");
		const finishOpen = () => {
			this.openFrame = 0;
			if (!this.transitionMatches("discovery", generation)) return;
			this.root.classList.add("discovery-visible");
			this.elements.discoveryShell.style.height = `${this.elements.discoveryPanel.offsetHeight}px`;
			if (this.reducedMotion.matches) {
				this.elements.discoveryShell.offsetHeight;
				this.elements.discoveryClose.style.visibility = "visible";
			}
			this.elements.discoveryClose.focus({ preventScroll: true });
		};
		if (this.reducedMotion.matches) {
			this.elements.discoveryShell.style.transition = "none";
			finishOpen();
		} else {
			this.elements.discoveryShell.style.height = "0px";
			this.elements.discoveryShell.offsetHeight;
			this.openFrame = this.scheduler.requestFrame(finishOpen);
		}
	}
	close(kind, fallbackFocus, onStart, onClosed, focusOverride = null) {
		if (this.closing || this.kind !== kind) return;
		this.closing = true;
		const generation = ++this.transitionGeneration;
		this.scheduler.cancelFrame(this.openFrame);
		this.openFrame = 0;
		this.cancelCloseWait();
		if (kind === "result") {
			this.elements.card.classList.add("modal-closing");
			this.elements.card.classList.remove("modal-visible");
		} else {
			this.root.classList.remove("discovery-visible");
			this.elements.discoveryShell.style.height = `${this.elements.discoveryShell.offsetHeight}px`;
			this.elements.discoveryShell.offsetHeight;
			this.elements.discoveryShell.style.height = "0px";
			this.elements.discoveryButton.setAttribute("aria-expanded", "false");
		}
		onStart();
		const duration = this.reducedMotion.matches ? 0 : kind === "result" ? this.durations.result : this.durations.discovery;
		const finish = () => {
			if (this.kind !== kind || this.transitionGeneration !== generation) return;
			this.cancelCloseWait();
			if (kind === "result") {
				this.elements.card.classList.remove("modal-open", "modal-visible", "modal-closing");
				this.elements.result.setAttribute("aria-hidden", "true");
			} else {
				this.root.classList.remove("discovery-open", "discovery-visible");
				this.elements.discoveryModal.setAttribute("aria-hidden", "true");
				this.elements.discoveryShell.style.height = "";
				this.elements.discoveryShell.style.transition = "";
				this.elements.discoveryClose.style.visibility = "";
			}
			this.kind = null;
			this.closing = false;
			this.unlockScroll();
			onClosed();
			const preferred = this.returnFocus;
			this.returnFocus = null;
			const target = focusOverride && this.canFocus(focusOverride) ? focusOverride : preferred && this.canFocus(preferred) ? preferred : fallbackFocus;
			if (this.canFocus(target)) target.focus({ preventScroll: true });
		};
		if (duration <= 0) {
			finish();
			return;
		}
		const transitionTarget = kind === "result" ? this.elements.result : this.elements.discoveryShell;
		const transitionProperty = kind === "result" ? "background-color" : "height";
		this.closeListener = (event) => {
			const transition = event;
			if (event.target === transitionTarget && (!transition.propertyName || transition.propertyName === transitionProperty || kind === "result" && transition.propertyName === "background")) finish();
		};
		transitionTarget.addEventListener("transitionend", this.closeListener);
		this.closeTimer = this.scheduler.setTimer(finish, duration);
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
		this.scrollLockDepth += 1;
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
		this.scrollLockDepth = Math.max(0, this.scrollLockDepth - 1);
		if (this.scrollLockDepth) return;
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
		if (this.closeListener) {
			this.elements.result.removeEventListener("transitionend", this.closeListener);
			this.elements.discoveryShell.removeEventListener("transitionend", this.closeListener);
		}
		this.closeListener = null;
	}
};
//#endregion
//#region src/ui/result-presenter.ts
function formatClock(seconds) {
	const safe = Math.max(0, seconds);
	return `${Math.floor(safe / 60)}:${String(Math.floor(safe) % 60).padStart(2, "0")}`;
}
function formatAccuracy(value) {
	return Number.isSafeInteger(value) ? `${value}%` : "--";
}
function formatAttempts(value) {
	return value ? `ATTEMPTS: ${value}` : "ATTEMPTS: --";
}
function formatAverage(value) {
	if (!Number.isFinite(value) || value <= 0) return "--";
	const rounded = Math.round(value * 10) / 10;
	return `${Number.isInteger(rounded) ? rounded : rounded.toFixed(1)}s`;
}
function resultRows(result) {
	if (result.mode === "daily") return [
		["TRACK:", result.trackTitle],
		["RUN:", formatAttempts(result.attempts)],
		[result.newPersonalBest ? "NEW PERSONAL BEST:" : "PERSONAL BEST:", formatAttempts(result.bestAttempts)]
	];
	if (result.mode === "classic") return [
		["TRACK:", result.trackTitle],
		["RUN:", `${result.won ? "STREAK" : "STREAK ENDED"}: ${result.streak} · AVERAGE SNIPPET: ${formatAverage(result.average)}`],
		[result.newPersonalBest ? "NEW PERSONAL BEST:" : "PERSONAL BEST:", `STREAK: ${result.bestStreak} · AVERAGE SNIPPET: ${formatAverage(result.bestAverage)}`]
	];
	if (result.mode === "blitz") return [["RUN:", `CORRECT GUESSES: ${result.correct} · ACCURACY: ${formatAccuracy(result.accuracy)}`], [result.newPersonalBest ? "NEW PERSONAL BEST:" : "PERSONAL BEST:", `CORRECT GUESSES: ${result.bestCorrect} · ACCURACY: ${formatAccuracy(result.bestAccuracy)}`]];
	if (result.mode === "speedrun") {
		const personalBest = result.bestTrackCount ? `TIME: ${formatClock(result.bestElapsedMs / 1e3)} · ${result.bestTrackCount} TRACKS` : "NO RECORD";
		return [["RUN:", `TIME: ${formatClock(result.elapsedMs / 1e3)} · TRACKS: ${result.completedTracks}/${result.catalogTrackCount}`], [result.newPersonalBest ? "NEW PERSONAL BEST:" : "PERSONAL BEST:", personalBest]];
	}
	return [["RUN:", `TIME SURVIVED: ${formatClock(result.elapsedMs / 1e3)} · ACCURACY: ${formatAccuracy(result.accuracy)}`], [result.newPersonalBest ? "NEW PERSONAL BEST:" : "PERSONAL BEST:", `TIME SURVIVED: ${formatClock(result.bestElapsedMs / 1e3)} · ACCURACY: ${formatAccuracy(result.bestAccuracy)}`]];
}
function resultAnnouncement(result, rows = resultRows(result)) {
	return `${result.mode === "speedrun" ? result.won ? "SPEEDRUN COMPLETE." : "TIME IS UP." : result.mode === "blitz" || result.mode === "survival" ? "TIME IS UP." : result.won ? "YOU GOT IT." : "YOU GOT IT ALL WRONG."} ${rows.map((row) => `${row[0]?.replace(/:$/, "") ?? "RESULT"}. ${row.slice(1).join(". ")}`.trim()).join(". ")}`.trim();
}
function createResultModule(row, newPersonalBest) {
	const module = document.createElement("div");
	module.className = "result-module";
	module.replaceChildren(...row.map((value, index) => {
		const span = document.createElement("span");
		span.className = index ? "result-value" : "result-label";
		if (!index && newPersonalBest && value === "NEW PERSONAL BEST:") span.classList.add("blink");
		span.textContent = value;
		return span;
	}));
	return module;
}
//#endregion
//#region src/ui/progress-summary.ts
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
		this.container.classList.toggle("has-speedrun-best", bests.speedrun.trackCount > 0);
		this.container.replaceChildren(...summaryRows.map((row) => {
			const item = document.createElement("div");
			item.className = "progress-best";
			if (row.mode === "SPEEDRUN") item.classList.add("progress-best-speedrun");
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
	const dailyComplete = daily.date === dailyDate && daily.completed;
	const standard = [
		{
			mode: "DAILY",
			value: dailyComplete ? daily.won ? `${daily.step + 1}/6` : "FAILED" : "",
			detail: dailyComplete ? formatOrdinalDate(daily.date) : ""
		},
		{
			mode: "CLASSIC",
			value: bests.classic.best ? `${bests.classic.best}-GAME STREAK` : "--",
			detail: bests.classic.best ? `AVERAGE ${formatDecimal(classicAverage)}s` : "NO RECORD"
		},
		{
			mode: "BLITZ",
			value: bests.blitz.score ? `${bests.blitz.score} CORRECT` : "--",
			detail: bests.blitz.score ? `${bests.blitz.accuracy ?? 0}% ACCURACY` : "NO RECORD"
		},
		{
			mode: "SURVIVAL",
			value: bests.survival.score ? `${formatClock(bests.survival.score / 1e3)} SURVIVED` : "--",
			detail: bests.survival.score ? `${bests.survival.accuracy ?? 0}% ACCURACY` : "NO RECORD"
		}
	];
	if (bests.speedrun.trackCount > 0) standard.push({
		mode: "SPEEDRUN",
		value: formatClock(bests.speedrun.timeMs / 1e3),
		detail: `${bests.speedrun.trackCount} ${bests.speedrun.trackCount === 1 ? "TRACK" : "TRACKS"}`
	});
	return standard;
}
function formatDecimal(value) {
	return Number.isInteger(value) ? String(value) : value.toFixed(1);
}
//#endregion
//#region src/ui/timeline-view.ts
var TimelineView = class {
	elements;
	durations;
	reducedMotion;
	scheduler;
	motionGeneration = 0;
	progressTimer = 0;
	progressListener = null;
	rewindActive = false;
	survivalTimer = 0;
	survivalListener = null;
	survivalGeneration = 0;
	constructor(elements, durations, reducedMotion, scheduler = browserUiScheduler) {
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
	beginReset(rewindPlayback = false) {
		if (rewindPlayback && this.rewindActive) return;
		const previousScale = this.progressScale();
		this.cancelProgressMotion();
		const generation = ++this.motionGeneration;
		if (rewindPlayback) {
			this.setProgress("0:00", 0);
			if (this.reducedMotion.matches || this.durations.rewind <= 0 || previousScale <= 1e-4) return;
			this.elements.timeline.style.setProperty("--rewind-from", String(previousScale));
			this.elements.timeline.offsetWidth;
			this.rewindActive = true;
			this.elements.timeline.classList.add("progress-rewinding");
			this.waitForProgressMotion("animationend", this.elements.timeline, this.durations.rewind, generation, (event) => {
				const animation = event;
				return !animation.animationName || animation.animationName === "corzaguessr-progress-rewind";
			});
			return;
		}
		if (this.reducedMotion.matches || this.durations.progress <= 0) return;
		this.elements.fill.style.transform = `scaleX(${previousScale})`;
		this.elements.fill.offsetWidth;
		this.elements.fill.style.transition = "transform var(--duration-progress) ease-out";
		this.waitForProgressMotion("transitionend", this.elements.fill, this.durations.progress, generation, (event) => {
			const transition = event;
			return !transition.propertyName || transition.propertyName === "transform";
		});
	}
	flashSurvivalChange(seconds) {
		if (!seconds) return;
		this.clearSurvivalFeedback();
		this.elements.timeChangeText.textContent = seconds > 0 ? `+${seconds}S` : `${seconds}S`;
		if (this.durations.feedback <= 0) {
			this.clearSurvivalFeedback();
			return;
		}
		if (this.reducedMotion.matches) this.elements.timeChange.classList.add("survival-change-static");
		else {
			this.elements.feedback.offsetWidth;
			this.elements.feedback.classList.add(seconds > 0 ? "survival-reward" : "survival-penalty");
			this.elements.timeChange.classList.add("survival-change");
		}
		const generation = ++this.survivalGeneration;
		const finish = () => {
			if (generation !== this.survivalGeneration) return;
			this.clearSurvivalFeedback();
		};
		if (!this.reducedMotion.matches) {
			this.survivalListener = (event) => {
				const animation = event;
				if (event.target === this.elements.timeChangeText && (!animation.animationName || animation.animationName === "corzaguessr-survival-hit")) finish();
			};
			this.elements.timeChangeText.addEventListener("animationend", this.survivalListener);
		}
		this.survivalTimer = this.scheduler.setTimer(finish, this.durations.feedback);
	}
	clearSurvivalFeedback() {
		this.survivalGeneration += 1;
		if (this.survivalTimer) this.scheduler.clearTimer(this.survivalTimer);
		this.survivalTimer = 0;
		if (this.survivalListener) this.elements.timeChangeText.removeEventListener("animationend", this.survivalListener);
		this.survivalListener = null;
		this.elements.feedback.classList.remove("survival-reward", "survival-penalty");
		this.elements.timeChange.classList.remove("survival-change", "survival-change-static");
		this.elements.timeChangeText.textContent = "";
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
		this.rewindActive = false;
		this.elements.timeline.classList.remove("progress-rewinding");
		this.elements.timeline.style.removeProperty("--rewind-from");
		this.elements.fill.style.transition = "";
	}
};
//#endregion
//#region src/ui/volume-control.ts
var BAR_COUNT = 8;
var VolumeControl = class {
	container;
	input;
	bars;
	handler = null;
	constructor(container, input, initialVolume) {
		this.container = container;
		this.input = input;
		this.bars = [...container.querySelectorAll(".volume-bar")];
		if (this.bars.length !== BAR_COUNT) throw new Error(`Corzaguessr volume control requires ${BAR_COUNT} bars.`);
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
		const activeBars = volume === 0 ? 0 : Math.ceil(volume * BAR_COUNT / 100);
		this.container.dataset.volume = String(volume);
		this.container.classList.toggle("muted", volume === 0);
		this.input.setAttribute("aria-valuetext", volume === 0 ? "Muted" : `${volume} percent`);
		this.bars.forEach((bar, index) => {
			bar.classList.toggle("active", index < activeBars);
		});
	}
};
//#endregion
//#region src/ui/game-view.ts
var ICONS = {
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
	durations;
	handlers = null;
	state = null;
	inputModality;
	hoveredButton = null;
	preview = null;
	resultSignature = "";
	resultCopyFeedbackTimer = 0;
	resultCopyFeedbackGeneration = 0;
	rulesSignature = "";
	announcementFrame = 0;
	constructor(root, initialVolume = 100, coverUrl = (dailyNumber) => `covers/${trackAssetNumber(dailyNumber)}.webp`) {
		this.root = root;
		this.inputModality = this.finePointer.matches ? "pointer-fine" : "pointer-coarse";
		root.dataset.corzaguessrReady = "true";
		root.innerHTML = markup();
		this.elements = this.queryElements();
		this.audioElements = this.elements.audioPlayers;
		this.modeButtons = {
			daily: this.required("[data-mode=\"daily\"]"),
			blitz: this.required("[data-mode=\"blitz\"]"),
			classic: this.required("[data-mode=\"classic\"]"),
			survival: this.required("[data-mode=\"survival\"]")
		};
		const styles = getComputedStyle(root);
		this.durations = {
			feedback: duration(styles, "--duration-feedback"),
			wiggle: duration(styles, "--duration-wiggle"),
			slot: duration(styles, "--duration-slot"),
			result: duration(styles, "--duration-result"),
			discovery: duration(styles, "--duration-discovery"),
			progress: duration(styles, "--duration-progress"),
			rewind: duration(styles, "--duration-rewind")
		};
		this.modal = new ModalController(root, this.elements, this.durations, this.reducedMotion, (message) => this.announce(message));
		this.autocomplete = new Autocomplete(this.elements.guess, this.elements.suggest, (id) => this.handlers?.guess(id), () => this.handlers?.playbackShortcut());
		this.attempts = new AttemptHistoryView({
			container: this.elements.currentSlot.parentElement,
			current: this.elements.currentSlot,
			history: this.elements.slots
		}, {
			slot: this.durations.slot,
			wiggle: this.durations.wiggle,
			collapse: () => this.modal.openKind === "result" ? this.durations.result : this.durations.slot
		}, this.reducedMotion);
		this.timeline = new TimelineView({
			timeline: this.elements.timeline,
			now: this.elements.now,
			fill: this.elements.fill,
			feedback: this.elements.feedback,
			timeChange: this.elements.timeChange,
			timeChangeText: this.elements.timeChangeText
		}, this.durations, this.reducedMotion);
		this.volume = new VolumeControl(this.elements.volumeControl, this.elements.volumeRange, initialVolume);
		this.discovery = new DiscoveryListView(this.elements.discoveryCount, this.elements.discoveryItems, coverUrl);
		this.progressSummary = new ProgressSummaryView(this.elements.progressBests);
		if (typeof ResizeObserver !== "undefined") new ResizeObserver(() => {
			if (this.modal.discoveryLayoutActive) this.elements.discoveryShell.style.height = `${this.elements.discoveryPanel.offsetHeight}px`;
		}).observe(this.elements.discoveryPanel);
	}
	bind(handlers) {
		this.handlers = handlers;
		this.volume.bind(handlers.setVolume);
		this.discovery.bind(handlers.openDiscoverySpotify, handlers.startSpeedrun);
		this.elements.play.addEventListener("click", handlers.play);
		this.elements.skip.addEventListener("click", handlers.skip);
		this.elements.resultAction.addEventListener("click", handlers.resultAction);
		this.elements.resultSecondary.addEventListener("click", () => {
			if (this.state?.result?.mode === "daily") handlers.shareDaily();
			else handlers.openSpotify();
		});
		this.elements.discoveryButton.addEventListener("click", handlers.openDiscovery);
		this.elements.discoveryClose.addEventListener("click", handlers.closeDiscovery);
		this.elements.discoveryReset.addEventListener("click", () => {
			if (window.confirm("RESET ALL PROGRESS? THIS ERASES DISCOVERY, DAILY PROGRESS, AND RECORDS.")) handlers.resetProgress();
		});
		this.elements.discoveryModal.addEventListener("click", (event) => {
			if (!(event.target instanceof Element && event.target.closest(".discovery-panel"))) handlers.closeDiscovery();
		});
		for (const [mode, button] of Object.entries(this.modeButtons)) {
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
		this.state = state;
		this.root.dataset.appStatus = state.appStatus;
		this.root.dataset.sessionStatus = state.phase;
		const transportVisible = state.transportText !== "";
		this.root.classList.toggle("rules-visible", !state.inputVisible || transportVisible);
		this.root.classList.toggle("timed", isTimedMode(state.mode));
		const awaiting = state.appStatus === "awaiting-mode";
		this.elements.modePrompt.setAttribute("aria-hidden", String(!awaiting));
		this.elements.play.disabled = !state.playEnabled;
		this.elements.skip.disabled = !state.skipEnabled;
		this.elements.guess.disabled = !state.guessEnabled || transportVisible;
		const blockedBoard = awaiting || state.appStatus === "loading";
		const overlay = state.overlay !== null;
		this.elements.headerAction.inert = overlay;
		this.elements.modes.inert = overlay;
		this.elements.board.inert = overlay;
		this.elements.currentSlot.inert = overlay || blockedBoard;
		this.elements.slots.inert = overlay || blockedBoard;
		for (const [mode, button] of Object.entries(this.modeButtons)) {
			const selected = mode === state.mode;
			button.disabled = state.appStatus === "error" || selected || state.overlay === "discovery";
			button.setAttribute("aria-pressed", String(selected));
		}
		this.elements.icon.setAttribute("d", ICONS[state.playbackIcon]);
		this.elements.play.setAttribute("aria-label", state.playbackIcon === "play" ? "PLAY" : state.playbackIcon === "pause" ? "PAUSE" : "STOP");
		this.elements.skip.textContent = state.skipText;
		this.elements.snippet.style.width = `${state.snippetSeconds / SNIPPET_SECONDS.at(-1) * 100}%`;
		this.renderRules();
		this.attempts.render(state.currentSlot, state.history, sessionKey);
		this.autocomplete.setDependencies(state.tracks, state.unavailableGuessIds);
		this.renderDiscovery(state);
		this.progressSummary.render(state.personalBests, state.dailyProgress, state.dailyDate);
		this.renderResult(state.result);
		this.renderClock(state.clock);
	}
	renderClock(clock) {
		const state = this.state;
		if (!state) return;
		const mode = state.mode;
		let display = "0:00";
		let progress = 0;
		if (!mode) this.elements.endtime.textContent = "0:01";
		else if (isTimedMode(mode)) {
			const rule = MODE_RULES[mode];
			const survival = rule.clockDisplay === "survival";
			const initial = rule.initialTimeMs;
			this.elements.endtime.textContent = formatClock(survival ? Math.ceil(clock.remainingMs / 1e3) : initial / 1e3);
			display = formatClock((survival ? clock.elapsedMs : clock.remainingMs) / 1e3);
			const denominator = survival ? clock.maxRemainingMs : initial;
			progress = denominator ? clock.remainingMs / denominator : 0;
		} else {
			const seconds = mode === "daily" && !state.inputVisible && state.dailyProgress.date === state.dailyDate && state.dailyProgress.started ? state.snippetSeconds : clock.elapsedMs / 1e3;
			this.elements.endtime.textContent = `0:${String(state.snippetSeconds).padStart(2, "0")}`;
			display = formatClock(seconds);
			progress = seconds ? seconds / SNIPPET_SECONDS.at(-1) + .0025 : 0;
		}
		this.timeline.setProgress(display, progress);
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
	flashSurvivalChange(seconds) {
		this.timeline.flashSurvivalChange(seconds);
	}
	beginProgressReset(animate = false) {
		this.timeline.beginReset(animate);
	}
	clearAttemptEntry() {
		this.autocomplete.reset();
	}
	showDailyShareCopied() {
		if (this.state?.overlay !== "result" || this.state.result?.mode !== "daily") return;
		if (this.resultCopyFeedbackTimer) window.clearTimeout(this.resultCopyFeedbackTimer);
		const generation = ++this.resultCopyFeedbackGeneration;
		this.elements.resultSecondaryLabel.classList.remove("fading");
		this.elements.resultSecondaryLabel.textContent = "COPIED";
		this.resultCopyFeedbackTimer = window.setTimeout(() => {
			this.resultCopyFeedbackTimer = 0;
			if (this.state?.overlay === "result" && this.state.result?.mode === "daily") this.swapResultSecondaryLabel("SHARE", generation);
		}, this.durations.feedback);
	}
	resetTransientUi() {
		cancelAnimationFrame(this.announcementFrame);
		this.elements.status.textContent = "";
		this.timeline.clearSurvivalFeedback();
		this.preview = null;
		this.clearAttemptEntry();
		this.renderRules();
	}
	focusPlay() {
		if (!this.elements.play.disabled && !this.elements.play.closest("[inert]")) this.elements.play.focus({ preventScroll: true });
	}
	focusMode(mode) {
		const button = this.modeButtons[mode];
		if (!button.disabled && !button.closest("[inert]")) button.focus({ preventScroll: true });
	}
	focusGuess() {
		if (this.inputModality !== "pointer-coarse" && !this.elements.guess.disabled && !this.elements.guess.closest("[inert]")) queueMicrotask(() => this.elements.guess.focus({ preventScroll: true }));
	}
	openResult() {
		this.modal.openResult();
	}
	closeResult(returnFocus, beforeClose, afterClose) {
		const target = returnFocus === "classic" ? this.modeButtons.classic : this.elements.play;
		this.modal.close("result", this.elements.play, beforeClose, afterClose, target);
	}
	openDiscovery() {
		this.modal.openDiscovery();
	}
	closeDiscovery(returnFocus, afterClose) {
		const target = returnFocus === "play" ? this.elements.play : this.elements.discoveryButton;
		this.modal.close("discovery", this.elements.discoveryButton, () => {}, afterClose, target);
	}
	renderRules() {
		if (!this.state) return;
		const text = this.state.transportText || (!this.preview || this.preview === this.state.mode ? this.state.rulesText : this.preview === "discovery" ? COPY.progress : MODE_RULES[this.preview].description);
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
	renderResult(result) {
		const signature = result ? JSON.stringify(result) : "";
		if (signature === this.resultSignature) return;
		this.resultSignature = signature;
		if (this.resultCopyFeedbackTimer) {
			window.clearTimeout(this.resultCopyFeedbackTimer);
			this.resultCopyFeedbackTimer = 0;
		}
		this.resultCopyFeedbackGeneration += 1;
		this.elements.resultSecondaryLabel.classList.remove("fading");
		if (!result) {
			this.elements.resultTitle.textContent = "";
			this.elements.resultMeta.replaceChildren();
			this.elements.resultSecondary.hidden = true;
			return;
		}
		const timedOut = result.mode === "blitz" || result.mode === "survival" || result.mode === "speedrun" && !result.won;
		this.elements.resultAction.textContent = result.mode === "daily" ? "CLOSE" : "NEW GAME";
		this.elements.resultTitle.innerHTML = result.mode === "speedrun" && result.won ? "&#127937; <span class=\"end\">SPEEDRUN COMPLETE</span> &#127937;" : timedOut ? "&#9201;&#65039; <span class=\"end\">TIME IS UP</span> &#9201;&#65039;" : `${result.won ? "&#127881;" : "&#10060;"} <span class="end">${result.won ? "YOU GOT IT" : "YOU GOT IT ALL WRONG"}</span> ${result.won ? "&#127881;" : "&#10060;"}`;
		const rows = resultRows(result);
		this.elements.resultMeta.replaceChildren(...rows.map((row) => createResultModule(row, result.newPersonalBest)));
		this.elements.resultMeta.dataset.announcement = resultAnnouncement(result, rows);
		const daily = result.mode === "daily";
		this.elements.resultSecondaryLabel.textContent = daily ? "SHARE" : "SPOTIFY";
		this.elements.resultSecondary.setAttribute("aria-label", daily ? "SHARE DAILY RESULT" : "OPEN RESULT TRACK ON SPOTIFY");
		this.elements.resultSecondary.hidden = !daily && (result.mode !== "classic" || !result.spotify);
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
	swapResultSecondaryLabel(text, generation) {
		const label = this.elements.resultSecondaryLabel;
		if (label.textContent === text || this.reducedMotion.matches) {
			label.textContent = text;
			return;
		}
		label.classList.remove("fading");
		label.offsetWidth;
		label.classList.add("fading");
		window.setTimeout(() => {
			if (generation !== this.resultCopyFeedbackGeneration) return;
			label.textContent = text;
			label.classList.remove("fading");
		}, this.durations.rewind);
	}
	previewAllowed() {
		return !!this.state && ["awaiting-mode", "ready"].includes(this.state.appStatus) && this.state.overlay === null && !this.state.inputVisible;
	}
	handleRootKeydown(event) {
		if (!this.handlers || !this.state) return;
		const pointerAnchor = this.inputModality === "pointer-fine" && this.hoveredButton && this.canNavigateTo(this.hoveredButton) ? this.hoveredButton : null;
		const guessOwnsInput = this.state.guessEnabled && document.activeElement === this.elements.guess;
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
			if (target === this.elements.volumeRange) return;
			if (target === this.elements.guess && this.state.inputVisible) return;
			if (this.state.inputVisible && this.state.guessEnabled) {
				event.preventDefault();
				this.focusGuess();
				return;
			}
			event.preventDefault();
			this.movePrimaryFocus(event.key, pointerAnchor);
			return;
		}
		if (event.key === "Enter" && this.state.appStatus !== "awaiting-mode" && !target?.closest("button, input, a, .suggest")) {
			event.preventDefault();
			this.handlers.playbackShortcut();
		}
	}
	isArrowKey(key) {
		return key === "ArrowUp" || key === "ArrowDown" || key === "ArrowLeft" || key === "ArrowRight";
	}
	moveModalFocus(overlay, key, pointerAnchor) {
		const candidates = overlay === "result" ? [this.elements.resultAction, this.elements.resultSecondary] : [this.elements.discoveryClose, this.elements.discoveryReset];
		this.cycleFocus(candidates, key, candidates[0], pointerAnchor);
	}
	movePrimaryFocus(key, pointerAnchor) {
		const elements = {
			discovery: this.elements.discoveryButton,
			daily: this.modeButtons.daily,
			blitz: this.modeButtons.blitz,
			classic: this.modeButtons.classic,
			survival: this.modeButtons.survival,
			play: this.elements.play
		};
		const entries = Object.entries(elements);
		const enabled = new Set(entries.filter(([, element]) => this.canNavigateTo(element)).map(([id]) => id));
		const currentElement = pointerAnchor && this.canNavigateTo(pointerAnchor) ? pointerAnchor : document.activeElement;
		const current = entries.find(([, element]) => element === currentElement)?.[0] ?? null;
		const completedDaily = this.state?.mode === "daily" && this.state.dailyProgress.date === this.state.dailyDate && this.state.dailyProgress.completed;
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
		if (!this.state.guessEnabled || this.state.overlay || target?.closest("button, input, a, .suggest")) return;
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
			currentSlot: this.required(".current-slot"),
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
			ruleset: this.required(".ruleset"),
			rulesetText: this.required(".ruleset-text"),
			rulesetCopy: this.required(".ruleset-copy"),
			modePrompt: this.required(".mode-prompt"),
			status: this.required(".status"),
			resultAction: this.required(".result-action"),
			resultSecondary,
			resultSecondaryLabel,
			result: this.required(".result-modal"),
			resultTitle: this.required("#corzaguessr-result-title"),
			resultMeta: this.required("#corzaguessr-result-meta"),
			discoveryButton: this.required(".discovery-button"),
			discoveryModal: this.required(".discovery-modal"),
			discoveryShell: this.required(".discovery-shell"),
			discoveryPanel: this.required(".discovery-panel"),
			discoveryClose: this.required(".discovery-close"),
			discoveryReset: this.required(".discovery-reset"),
			discoveryCount: this.required(".discovery-title small"),
			discoveryItems: this.required(".discovery-items"),
			progressBests: this.required(".progress-bests"),
			audioPlayers,
			volumeControl: this.required(".volume-control"),
			volumeRange: this.required(".volume-range")
		};
	}
};
function duration(styles, name) {
	const value = styles.getPropertyValue(name).trim();
	return value.endsWith("ms") ? Number.parseFloat(value) || 0 : value.endsWith("s") ? (Number.parseFloat(value) || 0) * 1e3 : 0;
}
function markup() {
	return `<div class="wrap"><h1>CORZAGUESSR&#10022;</h1><div class="row header-action"><button type="button" class="button discovery-button" aria-controls="corzaguessr-discovery" aria-expanded="false">PROGRESS</button></div><div class="modes" aria-label="GAME MODE"><button type="button" class="mode" data-mode="daily" aria-pressed="false">DAILY</button><button type="button" class="mode" data-mode="classic" aria-pressed="false">CLASSIC</button><button type="button" class="mode" data-mode="blitz" aria-pressed="false">BLITZ</button><button type="button" class="mode" data-mode="survival" aria-pressed="false">SURVIVAL</button></div><div class="card glass"><div class="stack"><div class="board"><div class="controls"><div class="time"><span class="now">0:00</span></div><button type="button" class="play" aria-label="PLAY" disabled><svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="${ICONS.play}"></path></svg></button><div class="time"><span class="endtime">0:01</span></div></div><div class="volume-control"><div class="volume-bars" aria-hidden="true"><i class="volume-bar"></i><i class="volume-bar"></i><i class="volume-bar"></i><i class="volume-bar"></i><i class="volume-bar"></i><i class="volume-bar"></i><i class="volume-bar"></i><i class="volume-bar"></i></div><input class="volume-range" type="range" min="0" max="100" step="1" value="100" aria-label="VOLUME" aria-valuetext="100 percent"></div><div class="timeline"><div class="snippet"></div><div class="fill"></div><div class="feedback"></div><div class="time-change"><span></span></div><i class="tick" style="left:3.125%"></i><i class="tick" style="left:6.25%"></i><i class="tick" style="left:12.5%"></i><i class="tick" style="left:25%"></i><i class="tick" style="left:50%"></i><i class="tick" style="left:100%"></i></div><div class="auto"><label class="sr-only" for="corzaguessr-guess">SEARCH FOR A TRACK</label><input id="corzaguessr-guess" class="guess" placeholder="HAVE A GUESS? SEARCH FOR IT HERE!" autocomplete="off" role="combobox" aria-autocomplete="list" aria-controls="corzaguessr-suggestions" aria-expanded="false" disabled><div class="ruleset" aria-hidden="true"><div class="ruleset-track"><span class="ruleset-text">${COPY.modePrompt}</span><span class="ruleset-copy">${COPY.modePrompt}</span></div></div><div id="corzaguessr-suggestions" class="suggest" role="listbox"></div></div><div class="row"><button type="button" class="button skip" disabled>ADD 1S</button></div></div><div class="history" aria-live="polite" aria-relevant="additions text"><div class="slot current-slot" hidden></div><div class="slots"></div></div></div><div class="result-modal" aria-hidden="true"><div class="result-shell"><div class="corzaguessr-modal glass" role="dialog" aria-modal="true" aria-labelledby="corzaguessr-result-title" aria-describedby="corzaguessr-result-meta" tabindex="-1"><h3 id="corzaguessr-result-title" class="modal-title"></h3><div id="corzaguessr-result-meta" class="result-meta"></div><div class="actions"><button type="button" class="button result-action">NEW GAME</button><button type="button" class="button result-secondary" hidden></button></div></div></div></div><div id="corzaguessr-discovery" class="discovery-modal" role="dialog" aria-modal="true" aria-label="PROGRESS" aria-hidden="true" tabindex="-1"><div class="discovery-shell"><div class="discovery-panel glass"><div class="discovery-title"><span>DISCOVERY</span><small>0 / 0 (0%)</small></div><div class="discovery-items" role="list"></div><section class="progress-summary" aria-labelledby="corzaguessr-records-title"><h4 id="corzaguessr-records-title">RECORDS</h4><div class="progress-bests"></div></section><div class="actions"><button type="button" class="button discovery-close">CLOSE</button><button type="button" class="button discovery-reset">RESET</button></div></div></div></div></div><p class="mode-prompt" role="status" aria-hidden="false">${COPY.modePrompt}</p></div><p class="sr-only status" aria-live="polite"></p><audio class="audio" preload="metadata" playsinline aria-hidden="true" hidden></audio><audio class="audio" preload="metadata" playsinline aria-hidden="true" hidden></audio>`;
}
//#endregion
//#region src/main.ts
var JSDELIVR_REPOSITORY_BASE_URL = new URL("https://cdn.jsdelivr.net/gh/HankeyThePoo/corzaguessr@main/");
var root = document.querySelector("#corzaguessr");
if (root && !root.dataset.corzaguessrReady) {
	const volumeSettings = new LocalStorageVolumeSettingsRepository();
	const initialVolume = volumeSettings.load();
	let volumePersistenceFailureAnnounced = false;
	const moduleUrl = new URL(import.meta.url);
	const coverBaseUrl = new URL("covers/", JSDELIVR_REPOSITORY_BASE_URL);
	const view = new GameView(root, initialVolume, (dailyNumber) => {
		return new URL(`${trackAssetNumber(dailyNumber)}.webp`, coverBaseUrl).href;
	});
	const catalogUrl = new URL("tracks.json", moduleUrl);
	const audioBaseUrl = new URL("tracks/", JSDELIVR_REPOSITORY_BASE_URL);
	catalogUrl.search = moduleUrl.search;
	let controller;
	let playback;
	const catalog = new RetryingCatalogLoader(new FetchTrackCatalogRepository(catalogUrl), {
		setTimeout: (callback, delayMs) => window.setTimeout(callback, delayMs),
		clearTimeout: (handle) => window.clearTimeout(handle)
	});
	const progress = new ProgressService(new LocalStorageProgressRepository(), { onPersistenceFailure: (failure) => controller?.onProgressPersistenceFailure(failure) });
	const clock = new GameClock({
		onTick: (snapshot) => controller?.onClockTick(snapshot),
		onExpired: () => controller?.onClockExpired()
	});
	const audio = new DualSlotAudioPlayer(view.audioElements, (round) => {
		const url = new URL(`${trackAssetNumber(round.track.dailyNumber)}.mp3`, audioBaseUrl);
		url.hash = `t=${round.clipStart}`;
		return url.href;
	}, {
		onReady: (event) => playback?.handleReady(event),
		onPlaying: (round) => playback?.handlePlaying(round),
		onWaiting: (round) => playback?.handleWaiting(round),
		onEnded: (round) => playback?.handleEnded(round),
		onBlocked: (round) => playback?.handleBlocked(round),
		onFailure: (failure) => playback?.handleFailure(failure)
	});
	audio.setVolume(initialVolume / 100);
	playback = new PlaybackCoordinator(audio, {
		onPending: (round) => controller?.onPending(round),
		onPlaying: (round, startedNewRound) => {
			controller?.onAudioPlaying(round, startedNewRound);
		},
		onWaiting: (round) => controller?.onAudioWaiting(round),
		onBlocked: (round) => controller?.onAudioBlocked(round),
		onEnded: (round) => controller?.onAudioEnded(round),
		onRecovery: (kind) => controller?.onAudioRecovery(kind),
		onLoading: () => controller?.onLoading()
	});
	const dailyBoundary = new BudapestDateBoundary((date) => controller?.handleDateChanged(date));
	controller = new GameController(catalog, progress, clock, playback, view, dailyBoundary, new BrowserExternalNavigator(), new BrowserResultClipboard());
	view.bind({
		selectMode: (mode) => controller.selectMode(mode),
		play: () => controller.play(),
		playbackShortcut: () => controller.playbackShortcut(),
		skip: () => controller.skip(),
		guess: (dailyNumber) => controller.guess(dailyNumber),
		resultAction: () => controller.resultAction(),
		openDiscovery: () => controller.openDiscovery(),
		closeDiscovery: () => controller.closeDiscovery(),
		resetProgress: () => controller.resetProgress(),
		openSpotify: () => controller.openSpotify(),
		shareDaily: () => controller.shareDaily(),
		openDiscoverySpotify: (dailyNumber) => controller.openDiscoverySpotify(dailyNumber),
		startSpeedrun: () => controller.startSpeedrun(),
		setVolume: (volume, committed) => {
			audio.setVolume(volume / 100);
			if (!committed) return;
			if (!volumeSettings.save(volume) && !volumePersistenceFailureAnnounced) {
				volumePersistenceFailureAnnounced = true;
				view.announce("VOLUME PREFERENCE COULD NOT BE SAVED IN THIS BROWSER.");
			}
		}
	});
	controller.bootstrap(dailyBoundary.current());
	document.addEventListener("visibilitychange", () => {
		if (document.hidden) controller.handleVisibilityHidden();
		else controller.handleVisibilityVisible();
	});
	window.addEventListener("pageshow", () => controller.handleVisibilityVisible());
}
//#endregion
