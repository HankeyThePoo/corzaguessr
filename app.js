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
var defaultRetryDelayMs = 5e3;
var loadingGraceMs = 2e3;
var Catalog = class {
	source;
	scheduler;
	retryDelayMs;
	generation = 0;
	retryTimer = 0;
	loadingTimer = 0;
	abortController = null;
	constructor(source, scheduler, retryDelayMs = defaultRetryDelayMs) {
		this.source = source;
		this.scheduler = scheduler;
		this.retryDelayMs = retryDelayMs;
	}
	load(date, callbacks) {
		this.cancelCurrent();
		const generation = this.generation;
		this.attempt(date, callbacks, generation);
	}
	cancelCurrent() {
		this.generation += 1;
		if (this.retryTimer) this.scheduler.clearTimeout(this.retryTimer);
		this.retryTimer = 0;
		this.clearLoadingTimer();
		this.abortController?.abort();
		this.abortController = null;
	}
	attempt(date, callbacks, generation) {
		if (generation !== this.generation) return;
		const controller = new AbortController();
		this.abortController = controller;
		const request = this.source.load(date, controller.signal);
		this.loadingTimer = this.scheduler.setTimeout(() => {
			this.loadingTimer = 0;
			if (generation === this.generation && !controller.signal.aborted) callbacks.onLoading();
		}, loadingGraceMs);
		request.then((tracks) => {
			if (generation !== this.generation || controller.signal.aborted) return;
			this.clearLoadingTimer();
			this.abortController = null;
			callbacks.onLoaded(tracks);
		}, (error) => {
			if (generation !== this.generation || controller.signal.aborted || error instanceof DOMException && error.name === "AbortError") return;
			this.clearLoadingTimer();
			this.abortController = null;
			callbacks.onError(error);
			if (!isRetryable(error)) return;
			this.retryTimer = this.scheduler.setTimeout(() => {
				this.retryTimer = 0;
				this.attempt(date, callbacks, generation);
			}, this.retryDelayMs);
		});
	}
	clearLoadingTimer() {
		if (this.loadingTimer) this.scheduler.clearTimeout(this.loadingTimer);
		this.loadingTimer = 0;
	}
};
function isRetryable(error) {
	return !(typeof error === "object" && error !== null && "retryable" in error && error.retryable === false);
}
var snippetDurations = [
	1,
	2,
	4,
	8,
	16,
	32
];
var modeRules = {
	classic: {
		initialTimeMs: null,
		description: "GUESS THE TRACK IN SIX TRIES AS MORE AUDIO IS REVEALED",
		gameplay: "puzzle",
		failurePolicy: "heard-fixed"
	},
	daily: {
		initialTimeMs: null,
		description: "ONE SHARED TRACK EACH DAY, GUESS IT IN SIX TRIES",
		gameplay: "puzzle",
		failurePolicy: "fixed"
	},
	blitz: {
		initialTimeMs: 6e4,
		description: "GUESS AS MANY TRACKS AS POSSIBLE BEFORE THE TIMER RUNS OUT",
		gameplay: "blitz",
		failurePolicy: "replace"
	},
	survival: {
		initialTimeMs: 3e4,
		description: "CORRECT GUESSES ADD TIME; MISTAKES AND SKIPS DRAIN IT",
		gameplay: "survival",
		failurePolicy: "replace"
	},
	gauntlet: {
		initialTimeMs: 3e4,
		description: "SURVIVE UNTIL YOU DISCOVER EVERY SONG",
		gameplay: "survival",
		failurePolicy: "replace"
	}
};
function isTimedMode(mode) {
	return mode !== null && modeRules[mode].gameplay !== "puzzle";
}
function isPuzzleMode(mode) {
	return mode !== null && modeRules[mode].gameplay === "puzzle";
}
function clockDisplayForMode(mode) {
	const gameplay = modeRules[mode].gameplay;
	return gameplay === "puzzle" ? "snippet" : gameplay === "blitz" ? "countdown" : "survival";
}
function modeAdjustsTime(mode) {
	return modeRules[mode].gameplay === "survival";
}
function snippetSeconds(attempt) {
	return snippetDurations[Math.max(0, Math.min(snippetDurations.length - 1, attempt))];
}
function skipLabel(mode, attempt) {
	if (isTimedMode(mode)) return "SKIP";
	if (attempt >= snippetDurations.length - 1) return "GIVE UP";
	return `ADD ${snippetDurations[attempt + 1] - snippetDurations[attempt]}S`;
}
function survivalAdjustment(outcome) {
	return outcome === "correct" ? 3e3 : outcome === "wrong" ? -1e3 : -2e3;
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
function updateGauntletBest(bests, won, elapsedMs, trackCount) {
	if (!won || trackCount <= 0) return {
		changed: false,
		newPersonalBest: false
	};
	const current = bests.gauntlet;
	const largerCatalog = trackCount > current.trackCount;
	const fasterCurrentCatalog = trackCount === current.trackCount && (current.trackCount === 0 || elapsedMs < current.timeMs);
	if (!largerCatalog && !fasterCurrentCatalog) return {
		changed: false,
		newPersonalBest: false
	};
	bests.gauntlet = {
		timeMs: elapsedMs,
		trackCount
	};
	return {
		changed: true,
		newPersonalBest: true
	};
}
var GameSession = class {
	modeState = null;
	roundState = null;
	roundNumberState = 0;
	attemptsState = [];
	resultState = null;
	get snapshot() {
		const timedAttempts = isTimedMode(this.modeState) ? this.attemptsState : [];
		const correctAttempts = timedAttempts.filter((attempt) => attempt.outcome === "correct");
		const gauntletFoundTrackIds = this.modeState === "gauntlet" ? new Set(correctAttempts.map((attempt) => attempt.trackNumber).filter((trackNumber) => trackNumber !== null)) : /* @__PURE__ */ new Set();
		return {
			mode: this.modeState,
			round: this.roundState ? this.copyRound(this.roundState) : null,
			roundNumber: this.roundNumberState,
			attempt: this.puzzleAttempt(),
			guesses: timedAttempts.filter((attempt) => attempt.outcome !== "skip").length,
			correct: correctAttempts.length,
			attempts: this.attemptsState.map((attempt) => ({ ...attempt })),
			guessedTrackIds: this.puzzleGuessedTrackIds(),
			gauntletFoundTrackIds,
			result: this.resultState ? { ...this.resultState } : null
		};
	}
	reset(mode, attempts = []) {
		this.modeState = mode;
		this.roundState = null;
		this.roundNumberState = 0;
		this.attemptsState = attempts.map((attempt) => ({ ...attempt }));
		this.resultState = null;
	}
	setRound(round) {
		if (this.roundNumberState === 0) this.roundNumberState = 1;
		this.roundState = this.copyRound(round);
	}
	clearRound() {
		this.roundState = null;
	}
	resolvePuzzleAttempt(outcome, guessed) {
		if (!isPuzzleMode(this.modeState)) throw new Error("Puzzle attempts require Daily or Classic mode.");
		const id = this.attemptsState.length + 1;
		const finished = outcome === "correct" || id === 6;
		this.attemptsState.unshift(this.createAttempt(id, outcome, guessed, false));
		return { finished };
	}
	resolveTimed(outcome, guessed) {
		if (!isTimedMode(this.modeState)) throw new Error("Timed attempts require Blitz, Survival, or Gauntlet mode.");
		const gauntletMilestone = !!(outcome === "correct" && this.modeState === "gauntlet" && this.roundState && !this.attemptsState.some((attempt) => attempt.outcome === "correct" && attempt.trackNumber === this.roundState?.track.dailyNumber));
		this.attemptsState.unshift(this.createAttempt(this.roundNumberState, outcome, guessed, gauntletMilestone));
		this.roundNumberState += 1;
		this.roundState = null;
	}
	finish(result) {
		if (!this.modeState || result.mode !== this.modeState) throw new Error("Game result mode must match the active session mode.");
		this.resultState = { ...result };
	}
	dismissResult() {
		if (!this.resultState) return;
		this.roundState = null;
		this.resultState = null;
	}
	puzzleAttempt() {
		if (!isPuzzleMode(this.modeState)) return 0;
		return this.attemptsState[0]?.outcome === "correct" || this.attemptsState.length === 6 ? Math.max(0, this.attemptsState.length - 1) : this.attemptsState.length;
	}
	puzzleGuessedTrackIds() {
		if (!isPuzzleMode(this.modeState)) return /* @__PURE__ */ new Set();
		return new Set(this.attemptsState.map((attempt) => attempt.trackNumber).filter((trackNumber) => trackNumber !== null));
	}
	createAttempt(id, outcome, guessed, gauntletMilestone) {
		const attempt = {
			id,
			outcome,
			trackNumber: outcome === "skip" ? null : guessed?.dailyNumber ?? null
		};
		return outcome === "correct" && gauntletMilestone ? {
			...attempt,
			gauntletMilestone: true
		} : attempt;
	}
	copyRound(round) {
		return {
			...round,
			track: { ...round.track }
		};
	}
};
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
function hasDailyTrackAvailable(tracks, date) {
	return tracks.some((track) => isReleasedBy(track, date));
}
function dailyClipStart(track, date) {
	const clip = Math.min(snippetDurations.at(-1), track.duration);
	const maximum = Math.max(0, Math.floor(track.duration - clip));
	return stableHash(`corzaguessr-daily-clip:${date}:${track.dailyNumber}`) % (maximum + 1);
}
function randomClipStart(track, timed, random = Math.random) {
	const clip = Math.min(timed ? 60 : snippetDurations.at(-1), track.duration);
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
function isReleasedBy(track, date) {
	return track.releaseDate !== null && track.releaseDate <= date;
}
function emptyDailyProgress() {
	return { status: "none" };
}
function dailyInProgress(progress, date) {
	return progress.status === "in-progress" && progress.date === date;
}
function dailyStarted(progress, date) {
	return progress.status !== "none" && progress.date === date;
}
function dailyCompleted(progress, date) {
	return progress.status === "completed" && progress.date === date;
}
function dailyWon(progress, date) {
	return dailyCompleted(progress, date) && progress.outcome === "won";
}
function dailyAttempt(progress) {
	if (progress.status === "none") return 0;
	return progress.status === "completed" ? Math.max(0, progress.attempts.length - 1) : progress.attempts.length;
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
		survival: {
			score: 0,
			accuracy: null
		},
		gauntlet: {
			timeMs: 0,
			trackCount: 0
		}
	};
}
var copy = {
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
function composeClockViewModel(input) {
	const { mode, clock } = input;
	if (!mode) return {
		currentText: "0:00",
		endText: "0:01",
		progress: 0
	};
	if (isTimedMode(mode)) {
		const initial = modeRules[mode].initialTimeMs;
		const survival = clockDisplayForMode(mode) === "survival";
		const seconds = (survival ? clock.elapsedMs : clock.remainingMs) / 1e3;
		const denominator = survival ? clock.maxRemainingMs : initial;
		return {
			currentText: formatClock(seconds),
			endText: formatClock(survival ? Math.ceil(clock.remainingMs / 1e3) : initial / 1e3),
			progress: denominator ? clock.remainingMs / denominator : 0
		};
	}
	const seconds = mode === "daily" && !input.inputVisible && input.dailyStarted ? input.snippetSeconds : clock.elapsedMs / 1e3;
	return {
		currentText: formatClock(seconds),
		endText: `0:${String(input.snippetSeconds).padStart(2, "0")}`,
		progress: seconds ? seconds / snippetDurations.at(-1) + .0025 : 0
	};
}
function formatClock(seconds) {
	const safe = Math.max(0, seconds);
	return `${Math.floor(safe / 60)}:${String(Math.floor(safe) % 60).padStart(2, "0")}`;
}
var shareUrl = "https://stolenvalorhq.com/corzaguessr";
var months$1 = [
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
	return `CORZAGUESSR✦ DAILY // ${formatShareDate(date)}\n\n${squares}\n${outcome}\n\n${shareUrl}`;
}
function formatShareDate(value) {
	const [, year, month, day] = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value) ?? [];
	const monthName = month ? months$1[Number(month) - 1] : void 0;
	return year && monthName && day ? `${monthName} ${Number(day)}, ${year}` : value;
}
function composeResultViewModel(result, persistenceFailed) {
	if (!result) return null;
	const rows = resultRows(result);
	const announcement = resultAnnouncement(result, rows);
	const daily = result.mode === "daily";
	const timedOut = result.mode === "blitz" || result.mode === "survival" || result.mode === "gauntlet" && !result.won;
	return {
		titleHtml: result.mode === "gauntlet" && result.won ? "&#127937; <span class=\"end\">GAUNTLET COMPLETE</span> &#127937;" : timedOut ? "&#9201;&#65039; <span class=\"end\">TIME IS UP</span> &#9201;&#65039;" : `${result.won ? "&#127881;" : "&#10060;"} <span class="end">${result.won ? "YOU GOT IT" : "YOU GOT IT ALL WRONG"}</span> ${result.won ? "&#127881;" : "&#10060;"}`,
		primaryLabel: daily ? "CLOSE" : "NEW GAME",
		rows,
		highlightPersonalBest: !daily && result.newPersonalBest,
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
function resultRows(result) {
	if (result.mode === "daily") return [["TRACK:", result.trackTitle], ["RUN:", formatAttempts(result.attempts)]];
	if (result.mode === "classic") return [
		["TRACK:", result.trackTitle],
		["RUN:", `${result.won ? "STREAK" : "STREAK ENDED"}: ${result.streak} · AVERAGE SNIPPET: ${formatAverage(result.average)}`],
		[result.newPersonalBest ? "NEW PERSONAL BEST:" : "PERSONAL BEST:", `STREAK: ${result.bestStreak} · AVERAGE SNIPPET: ${formatAverage(result.bestAverage)}`]
	];
	if (result.mode === "blitz") return [["RUN:", `CORRECT GUESSES: ${result.correct} · ACCURACY: ${formatAccuracy(result.accuracy)}`], [result.newPersonalBest ? "NEW PERSONAL BEST:" : "PERSONAL BEST:", `CORRECT GUESSES: ${result.bestCorrect} · ACCURACY: ${formatAccuracy(result.bestAccuracy)}`]];
	if (result.mode === "gauntlet") {
		const personalBest = result.bestTrackCount ? `TIME: ${formatClock(result.bestElapsedMs / 1e3)} · ${result.bestTrackCount} TRACKS` : "NO RECORD";
		return [["RUN:", `TIME: ${formatClock(result.elapsedMs / 1e3)} · TRACKS: ${result.completedTracks}/${result.catalogTrackCount}`], [result.newPersonalBest ? "NEW PERSONAL BEST:" : "PERSONAL BEST:", personalBest]];
	}
	return [["RUN:", `TIME SURVIVED: ${formatClock(result.elapsedMs / 1e3)} · ACCURACY: ${formatAccuracy(result.accuracy)}`], [result.newPersonalBest ? "NEW PERSONAL BEST:" : "PERSONAL BEST:", `TIME SURVIVED: ${formatClock(result.bestElapsedMs / 1e3)} · ACCURACY: ${formatAccuracy(result.bestAccuracy)}`]];
}
function resultAnnouncement(result, rows = resultRows(result)) {
	return `${result.mode === "gauntlet" ? result.won ? "GAUNTLET COMPLETE." : "TIME IS UP." : result.mode === "blitz" || result.mode === "survival" ? "TIME IS UP." : result.won ? "YOU GOT IT." : "YOU GOT IT ALL WRONG."} ${rows.map((row) => `${row[0]?.replace(/:$/, "") ?? "RESULT"}. ${row.slice(1).join(". ")}`.trim()).join(". ")}`.trim();
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
var maxVisibleTimedAttempts = 19;
function acceptsAttempt(session, transport) {
	return !!session.round && !session.result && !transport.retryNeeded && transport.activeRoundId === session.round.id;
}
function guessInputVisible(session, transport) {
	return !!session.round && !session.result && !transport.retryNeeded;
}
function dailyCatalogPending(mode, tracks, dailyDate, progress) {
	if (mode !== "daily" || !tracks.length) return false;
	if (dailyInProgress(progress, dailyDate)) return !isDailyTrackAvailable(tracks, dailyDate, progress.dailyNumber);
	return !hasDailyTrackAvailable(tracks, dailyDate);
}
function rulesText(input) {
	const { session, dailyProgress, dailyDate } = input;
	if (session.mode === "daily" && dailyCompleted(dailyProgress, dailyDate)) {
		const attempts = dailyAttempt(dailyProgress) + 1;
		return `${dailyWon(dailyProgress, dailyDate) ? "COMPLETED" : "FAILED"} IN ${attempts} ATTEMPT${attempts === 1 ? "" : "S"}, COME BACK IN ${formatDailyCountdown(input.dailyCountdownMs)}`;
	}
	if (input.appStatus === "loading") return input.catalogLoadingVisible ? copy.loadingCatalog : copy.modePrompt;
	if (input.appStatus === "error") return copy.catalogError;
	if (!session.mode) return copy.modePrompt;
	if (input.transport.retryNeeded) return copy.trackError;
	if (session.mode === "daily") {
		if (dailyCatalogPending(session.mode, input.tracks, dailyDate, dailyProgress)) return copy.trackUnavailable;
		if (dailyInProgress(dailyProgress, dailyDate)) return `DAILY IN PROGRESS, CONTINUE FROM ATTEMPT ${dailyAttempt(dailyProgress) + 1}`;
	}
	return modeRules[session.mode].description;
}
function formatDailyCountdown(milliseconds) {
	const totalSeconds = Math.max(0, Math.ceil(milliseconds / 1e3));
	return [
		Math.floor(totalSeconds / 3600),
		Math.floor(totalSeconds % 3600 / 60),
		totalSeconds % 60
	].map((value) => String(value).padStart(2, "0")).join(":");
}
function composeGameViewModel(input) {
	const { session, transport } = input;
	const requested = transport.playRequested;
	const tracksLeft = Math.max(0, input.tracks.length - session.gauntletFoundTrackIds.size);
	const attemptSlots = (isTimedMode(session.mode) ? session.attempts.slice(0, maxVisibleTimedAttempts) : session.attempts).map((attempt) => attemptSlot(attempt, session.mode, input.tracks));
	const completedDaily = session.mode === "daily" && dailyCompleted(input.dailyProgress, input.dailyDate);
	let headSlot = (session.mode === "daily" || session.mode === "classic") && (!!session.result || completedDaily) ? null : promptSlot(session, tracksLeft);
	if (session.result && isTimedMode(session.mode)) headSlot = {
		id: session.roundNumber,
		text: session.result.mode === "gauntlet" && session.result.won ? "GAUNTLET COMPLETE" : "TIME'S UP",
		tone: "neutral"
	};
	else if (transport.retryNeeded && headSlot) headSlot = {
		...headSlot,
		text: copy.trackError,
		tone: "technical"
	};
	const slots = headSlot ? [headSlot, ...attemptSlots] : attemptSlots;
	const dailyUnavailable = dailyCatalogPending(session.mode, input.tracks, input.dailyDate, input.dailyProgress);
	const dailyBlocked = session.mode === "daily" && (dailyUnavailable || dailyCompleted(input.dailyProgress, input.dailyDate) && !session.round);
	const roundHeard = !!session.round && transport.activeRoundId === session.round.id;
	const playControlAvailable = !session.round || transport.retryNeeded || roundHeard || transport.pendingRoundId === session.round.id;
	const inputVisible = guessInputVisible(session, transport);
	const guessEnabled = !!(input.appStatus === "ready" && session.round && inputVisible && !input.overlay);
	const attemptEnabled = !!(guessEnabled && session.round && acceptsAttempt(session, transport));
	return {
		appStatus: input.appStatus,
		mode: session.mode,
		rulesText: rulesText(input),
		transportText: transport.loading ? copy.loadingTrack : "",
		inputVisible,
		playEnabled: !!(input.appStatus === "ready" && session.mode && !input.overlay && !dailyBlocked && !transport.loading && playControlAvailable),
		guessEnabled,
		attemptEnabled,
		playbackIcon: requested ? isTimedMode(session.mode) ? "pause" : "stop" : "play",
		snippetSeconds: snippetSeconds(session.attempt),
		skipText: skipLabel(session.mode, session.attempt),
		slots,
		unavailableGuessIds: session.guessedTrackIds,
		clock: composeClockViewModel({
			mode: session.mode,
			snippetSeconds: snippetSeconds(session.attempt),
			inputVisible,
			clock: input.clock,
			dailyStarted: dailyStarted(input.dailyProgress, input.dailyDate)
		}),
		result: composeResultViewModel(session.result, input.resultPersistenceFailed),
		dailyProgress: input.dailyProgress,
		personalBests: input.personalBests,
		dailyDate: input.dailyDate,
		discoveries: input.discoveries,
		tracks: input.tracks,
		overlay: input.overlay
	};
}
function promptSlot(session, tracksLeft) {
	if (!session.mode) return null;
	if (isTimedMode(session.mode)) {
		if (session.roundNumber === 0) return null;
		return {
			id: session.roundNumber,
			text: session.mode === "gauntlet" ? `${tracksLeft} ${tracksLeft === 1 ? "TRACK" : "TRACKS"} LEFT` : `GUESS #${session.roundNumber}`,
			tone: "prompt"
		};
	}
	if (!session.round && session.attempts.length === 0) return null;
	return {
		id: session.attempt + 1,
		text: session.attempt === snippetDurations.length - 1 ? "LAST CHANCE TO GUESS" : `GUESS ${session.attempt + 1} OUT OF ${snippetDurations.length}`,
		tone: session.attempt === snippetDurations.length - 1 ? "final-prompt" : "prompt"
	};
}
function attemptSlot(attempt, mode, tracks) {
	let text = attempt.trackNumber === null ? "" : tracks.find((track) => track.dailyNumber === attempt.trackNumber)?.title ?? `TRACK #${attempt.trackNumber}`;
	if (attempt.outcome === "skip") if (isTimedMode(mode)) text = "SKIPPED";
	else if (attempt.id === 6) text = "FINAL GUESS SKIPPED";
	else {
		const added = snippetDurations[attempt.id] - snippetDurations[attempt.id - 1];
		text = `GUESS ${attempt.id} SKIPPED, ${added} SECOND${added === 1 ? "" : "S"} ADDED`;
	}
	const slot = {
		id: attempt.id,
		text,
		tone: attempt.outcome
	};
	return attempt.gauntletMilestone ? {
		...slot,
		gauntletMilestone: true
	} : slot;
}
var GameController = class {
	catalog;
	progress;
	clock;
	playback;
	view;
	dailySchedule;
	openSpotifyLink;
	copyToClipboard;
	random;
	session = new GameSession();
	catalogError = false;
	catalogLoadingVisible = false;
	tracks = [];
	latestDailyDate = "1970-01-01";
	dailyDate = "1970-01-01";
	dailyCountdownMs = 0;
	discoveryOpen = false;
	sessionNumber = 0;
	nextRoundId = 0;
	persistenceFailureQueued = false;
	resultPersistenceFailed = false;
	pageVisible = true;
	clockViewContext = {
		mode: null,
		snippetSeconds: 1,
		inputVisible: false,
		dailyStarted: false
	};
	constructor(catalog, progress, clock, playback, view, dailySchedule, openSpotifyLink, copyToClipboard, random = Math.random) {
		this.catalog = catalog;
		this.progress = progress;
		this.clock = clock;
		this.playback = playback;
		this.view = view;
		this.dailySchedule = dailySchedule;
		this.openSpotifyLink = openSpotifyLink;
		this.copyToClipboard = copyToClipboard;
		this.random = random;
	}
	bootstrap(date) {
		this.latestDailyDate = date;
		this.dailyDate = date;
		this.render();
		this.catalog.load(date, {
			onLoading: () => {
				this.catalogError = false;
				this.catalogLoadingVisible = true;
				this.render();
				this.view.announce(copy.loadingCatalog);
			},
			onLoaded: (tracks) => {
				this.catalogLoadingVisible = false;
				this.catalogError = false;
				this.tracks = tracks;
				this.prime();
				this.render();
				this.view.focusAfterCatalogReady();
			},
			onError: () => {
				this.catalogLoadingVisible = false;
				if (this.tracks.length) return;
				this.catalogError = true;
				this.view.announce(copy.catalogError);
				this.render();
			}
		});
	}
	selectMode(mode) {
		const state = this.session.snapshot;
		if (this.activeOverlay || this.catalogError || state.mode === mode) return;
		if (mode === "daily") {
			const date = this.dailySchedule.start();
			this.latestDailyDate = date;
			this.dailyDate = date;
		} else this.dailySchedule.stop();
		this.resetForMode(mode);
		this.view.announce(modeRules[mode].description);
		if (mode === "daily" && this.progress.dailyDone(this.dailyDate)) this.startDailyCountdown();
		this.view.focusAfterModeSelected();
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
		if (!round || !acceptsAttempt(state, this.playback.snapshot) || this.activeOverlay || state.guessedTrackIds.has(dailyNumber)) return;
		const guessed = this.tracks.find((track) => track.dailyNumber === dailyNumber);
		if (!guessed) return;
		this.resolveAttempt(dailyNumber === round.track.dailyNumber ? "correct" : "wrong", guessed);
	}
	resultAction() {
		const state = this.session.snapshot;
		const mode = state.mode;
		if (!mode) return;
		if (state.result) {
			if (mode === "daily" && this.progress.dailyDone(this.latestDailyDate)) {
				this.startDailyCountdown();
				this.session.dismissResult();
				this.resultPersistenceFailed = false;
				this.render();
				this.view.closeResult("classic");
				return;
			}
			if (mode === "daily" && this.latestDailyDate) this.dailyDate = this.latestDailyDate;
			this.resetForMode(mode);
			this.view.closeResult("play");
			return;
		}
	}
	openDiscovery() {
		if (this.discoveryOpen) {
			this.closeDiscovery();
			return;
		}
		if (this.activeOverlay) return;
		if (this.playback.ownedRound) {
			this.clock.pause();
			this.playback.suspend();
		}
		this.discoveryOpen = true;
		this.render();
	}
	closeDiscovery() {
		if (!this.discoveryOpen) return;
		this.view.beginDiscoveryClose({ outcome: "resume" });
	}
	startGauntlet() {
		if (!this.discoveryOpen || !this.gauntletUnlocked()) return;
		if (!this.view.beginDiscoveryClose({ outcome: "start-gauntlet" })) return;
		this.dailySchedule.stop();
	}
	onDiscoveryClosed(request) {
		if (!this.discoveryOpen) return;
		this.discoveryOpen = false;
		if (request.outcome === "start-gauntlet") {
			this.resetForMode("gauntlet");
			this.view.announce(modeRules.gauntlet.description);
			return;
		}
		if (this.playback.ownedRound && this.pageVisible) this.playback.restore();
		this.prime();
		this.render();
	}
	resetProgress() {
		if (!this.discoveryOpen) return;
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
		if (spotify) this.openSpotifyLink(spotify);
	}
	shareDaily() {
		const result = this.session.snapshot.result;
		if (result?.mode !== "daily") return;
		const sessionNumber = this.sessionNumber;
		const dailyDate = this.dailyDate;
		const stillCurrent = () => {
			return this.sessionNumber === sessionNumber && this.dailyDate === dailyDate && this.session.snapshot.result?.mode === "daily";
		};
		this.copyToClipboard(formatDailyShare(dailyDate, result)).then((copied) => {
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
		if (!this.discoveryOpen || !this.progress.discoveries.has(dailyNumber)) return;
		const spotify = this.tracks.find((track) => track.dailyNumber === dailyNumber)?.spotify ?? "";
		if (spotify) this.openSpotifyLink(spotify);
	}
	handleDailyDateChanged(date) {
		if (this.session.snapshot.mode !== "daily" || date === this.latestDailyDate) return;
		this.latestDailyDate = date;
		this.dailySchedule.stopCountdown();
		this.dailyCountdownMs = 0;
		if (!this.session.snapshot.result) {
			this.dailyDate = date;
			this.resetForMode("daily");
		}
	}
	handlePageVisible() {
		this.pageVisible = true;
		if (this.session.snapshot.mode === "daily") this.dailySchedule.reconcile();
		if (this.activeOverlay) return;
		if (this.playback.ownedRound) this.playback.restore();
		this.prime();
		this.render();
	}
	handlePageHidden() {
		this.pageVisible = false;
		const state = this.session.snapshot;
		if (!this.playback.ownedRound || state.result) return;
		const wasRequested = this.playback.snapshot.playRequested;
		this.clock.pause();
		this.playback.suspend();
		if (wasRequested) this.render();
	}
	onPending(round) {
		this.session.setRound(round);
		if (this.session.snapshot.mode === "daily") this.progress.markDailyStarted(this.dailyDate, round.track);
		this.render();
	}
	onAudioPlaying(round, startedNewRound) {
		if (startedNewRound) {
			this.session.setRound(round);
			const session = this.session.snapshot;
			this.refreshClockViewContext(session, this.playback.snapshot);
			if (!isTimedMode(session.mode)) this.clock.restart(snippetSeconds(session.attempt) * 1e3);
			this.clock.start();
			this.render();
			this.view.focusGuess();
			return;
		}
		if (this.session.snapshot.round?.id === round.id) {
			this.clock.start();
			this.render();
		}
	}
	onAudioWaiting(round) {
		if (this.playback.ownedRound?.id !== round.id) return;
		this.clock.pause();
		this.render();
	}
	onAudioBlocked(round) {
		if (this.playback.ownedRound?.id !== round.id) return;
		this.clock.pause();
		this.view.announce("PRESS PLAY TO START THE AUDIO.");
		this.render();
	}
	onAudioEnded(round) {
		const state = this.session.snapshot;
		if (state.round?.id !== round.id || this.playback.snapshot.activeRoundId !== round.id || state.result) return;
		this.clock.pause();
		if (isTimedMode(state.mode)) this.resolveAttempt("skip", null);
		else this.render();
	}
	onAudioRecovery(kind) {
		this.clock.pause();
		if (kind === "automatic-replacement") {
			this.session.clearRound();
			this.view.announce(copy.selectedTrackReplacing);
			return;
		}
		this.view.announce(kind === "selected-track-retry" ? copy.selectedTrackRetry : copy.trackError);
		this.render();
		this.view.focusPlay();
	}
	onLoading(visible) {
		this.render();
		if (visible) this.view.announce(copy.loadingTrack);
	}
	onProgressPersistenceFailure() {
		this.resultPersistenceFailed = true;
		if (this.persistenceFailureQueued) return;
		this.persistenceFailureQueued = true;
		queueMicrotask(() => {
			this.persistenceFailureQueued = false;
			if (this.session.snapshot.result) {
				this.render();
				return;
			}
			this.resultPersistenceFailed = false;
			this.view.announce("PROGRESS COULD NOT BE SAVED IN THIS BROWSER.");
		});
	}
	onClockTick(snapshot) {
		this.view.renderClock(composeClockViewModel({
			...this.clockViewContext,
			clock: snapshot
		}));
	}
	onClockExpired() {
		const state = this.session.snapshot;
		if (state.result || !state.round) return;
		if (isTimedMode(state.mode)) this.finishGame(false);
		else {
			this.playback.pause();
			this.render();
		}
	}
	handlePlay(shortcut) {
		if (this.session.snapshot.mode === "daily") this.dailySchedule.reconcile();
		const state = this.session.snapshot;
		const transport = this.playback.snapshot;
		const requested = transport.playRequested;
		const roundHeard = !!state.round && transport.activeRoundId === state.round.id;
		if (this.appStatus !== "ready" || !state.mode || this.activeOverlay || this.dailyCatalogPending() || state.mode === "daily" && this.progress.dailyDone(this.dailyDate) && !state.round) return;
		if (!state.round || transport.retryNeeded) {
			this.playback.start(transport.retryNeeded);
			return;
		}
		if (!roundHeard && transport.pendingRoundId === state.round.id && !requested) {
			this.playback.replay(state.round, false);
			this.render();
			return;
		}
		const round = state.round;
		if (!round || !roundHeard) return;
		if (isTimedMode(state.mode)) {
			if (requested) {
				this.clock.pause();
				this.playback.pause();
				this.render();
			} else {
				this.playback.replay(round, false);
				this.render();
			}
			this.view.focusGuess();
			return;
		}
		const stopping = requested && !shortcut;
		const pausing = requested || shortcut;
		const elapsed = pausing ? this.clock.pause().elapsedMs : this.clock.snapshot().elapsedMs;
		if (stopping) this.playback.rewind(round);
		else if (pausing) this.playback.pause();
		if (!stopping) this.playback.replay(round, elapsed > 0 || !roundHeard);
		this.view.resetTimeline();
		this.clock.restart(snippetSeconds(state.attempt) * 1e3);
		this.render();
		this.view.focusGuess();
	}
	resolveAttempt(outcome, guessed) {
		const state = this.session.snapshot;
		const round = state.round;
		const mode = state.mode;
		if (!round || !mode || !acceptsAttempt(state, this.playback.snapshot) || this.activeOverlay) return;
		if (isTimedMode(mode)) {
			if (this.clock.pause().remainingMs <= 0) {
				this.finishGame(false);
				return;
			}
		}
		this.view.resetGuessInput();
		if (outcome === "correct") this.progress.recordDiscovery(round.track.dailyNumber);
		if (isTimedMode(mode)) {
			this.playback.pause();
			this.session.resolveTimed(outcome, guessed);
			const updated = this.session.snapshot;
			this.refreshClockViewContext(updated, this.playback.snapshot);
			const gauntletComplete = mode === "gauntlet" && outcome === "correct" && updated.gauntletFoundTrackIds.size === this.tracks.length;
			this.view.announce(gauntletComplete ? "CORRECT. GAUNTLET COMPLETE." : outcome === "correct" ? "CORRECT." : outcome === "wrong" ? "INCORRECT." : "SKIPPED.");
			if (gauntletComplete) {
				this.finishGame(true, round);
				return;
			}
			if (modeAdjustsTime(mode)) {
				const adjustment = survivalAdjustment(outcome);
				this.view.flashTimeChange(adjustment / 1e3);
				if (this.clock.adjust(adjustment).remainingMs <= 0) {
					this.finishGame(false, round);
					return;
				}
			}
			this.playback.start();
			return;
		}
		const clockWasRunning = this.playback.snapshot.playRequested && this.clock.snapshot().running;
		const resolution = this.session.resolvePuzzleAttempt(outcome, guessed);
		const updated = this.session.snapshot;
		this.refreshClockViewContext(updated, this.playback.snapshot);
		this.view.announce(outcome === "correct" ? "CORRECT." : outcome === "wrong" ? "INCORRECT. TRY AGAIN." : "SKIPPED. MORE TIME ADDED.");
		if (resolution.finished) {
			this.finishGame(outcome === "correct");
			return;
		}
		if (mode === "daily" && this.progress.dailyInProgress(this.dailyDate)) this.progress.updateDailyAttempt(updated.attempts);
		const limit = snippetSeconds(updated.attempt) * 1e3;
		if (clockWasRunning) this.clock.extendTo(limit);
		else {
			this.playback.replay(round, true);
			this.view.resetTimeline();
			this.clock.restart(limit);
		}
		this.render();
		this.view.focusGuess();
	}
	finishGame(won, fallbackRound = null) {
		const state = this.session.snapshot;
		const round = state.round ?? fallbackRound;
		const mode = state.mode;
		if (!round || !mode || state.result) return;
		const clock = this.clock.pause();
		this.playback.stop();
		const result = this.progress.finish(finishedRun(mode, won, round, state, clock, this.dailyDate, this.tracks.length));
		this.session.finish(result);
		this.render();
	}
	resetForMode(mode) {
		this.dailySchedule.stopCountdown();
		this.dailyCountdownMs = 0;
		this.resultPersistenceFailed = false;
		this.sessionNumber += 1;
		const attempts = mode === "daily" ? this.progress.dailyAttempts(this.dailyDate) : [];
		const resumed = attempts.length;
		this.session.reset(mode, attempts);
		const milliseconds = modeRules[mode].initialTimeMs ?? snippetSeconds(resumed) * 1e3;
		this.clock.configure(milliseconds);
		this.playback.configure(mode, (failed, avoid) => this.createRound(mode, failed, avoid));
		this.prime();
		this.render();
	}
	resetToModeSelection() {
		this.dailySchedule.stop();
		this.sessionNumber += 1;
		this.resultPersistenceFailed = false;
		this.playback.reset();
		this.session.reset(null);
		this.clock.configure(1e3);
		this.render();
	}
	createRound(mode, failed, avoid) {
		let track;
		let clipStart;
		if (mode === "daily") {
			const daily = this.progress.daily;
			track = selectDailyTrack(this.tracks, this.dailyDate, dailyInProgress(daily, this.dailyDate) ? daily.dailyNumber : null);
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
		if (!this.pageVisible || !state.mode || !this.tracks.length || this.activeOverlay || this.dailyCatalogPending() || state.mode === "daily" && this.progress.dailyDone(this.dailyDate)) return;
		this.playback.prime();
	}
	dailyCatalogPending() {
		return dailyCatalogPending(this.session.snapshot.mode, this.tracks, this.dailyDate, this.progress.daily);
	}
	gauntletUnlocked() {
		return summarizeDiscovery(this.tracks, this.progress.discoveries).complete;
	}
	render() {
		const session = this.session.snapshot;
		const transport = this.playback.snapshot;
		this.refreshClockViewContext(session, transport);
		const viewModel = composeGameViewModel({
			appStatus: this.appStatus,
			catalogLoadingVisible: this.catalogLoadingVisible,
			session,
			transport,
			clock: this.clock.snapshot(),
			dailyProgress: this.progress.daily,
			personalBests: this.progress.personalBests,
			dailyDate: this.dailyDate,
			dailyCountdownMs: this.dailyCountdownMs,
			discoveries: this.progress.discoveries,
			tracks: this.tracks,
			overlay: this.activeOverlay,
			resultPersistenceFailed: this.resultPersistenceFailed
		});
		this.view.render(viewModel, String(this.sessionNumber));
	}
	refreshClockViewContext(session, transport) {
		this.clockViewContext = {
			mode: session.mode,
			snippetSeconds: snippetSeconds(session.attempt),
			inputVisible: guessInputVisible(session, transport),
			dailyStarted: this.progress.dailyInProgress(this.dailyDate) || this.progress.dailyDone(this.dailyDate)
		};
	}
	startDailyCountdown() {
		this.dailySchedule.startCountdown((remainingMs) => {
			this.dailyCountdownMs = remainingMs;
			if (!this.activeOverlay && this.session.snapshot.mode === "daily") this.render();
		});
	}
	get activeOverlay() {
		return this.session.snapshot.result ? "result" : this.discoveryOpen ? "discovery" : null;
	}
	get appStatus() {
		if (this.tracks.length) return this.session.snapshot.mode ? "ready" : "awaiting-mode";
		return this.catalogError ? "error" : "loading";
	}
};
function finishedRun(mode, won, round, state, clock, dailyDate, catalogTrackCount) {
	switch (mode) {
		case "daily": return {
			mode,
			won,
			track: round.track,
			dailyDate,
			attempts: state.attempts
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
		case "gauntlet": return {
			mode,
			won,
			elapsedMs: clock.elapsedMs,
			completedTrackCount: state.gauntletFoundTrackIds.size,
			catalogTrackCount
		};
	}
}
var Progress = class {
	storage;
	options;
	discoveriesState = /* @__PURE__ */ new Set();
	dailyState;
	bestsState;
	constructor(storage, options = {}) {
		this.storage = storage;
		this.options = options;
		const loaded = storage.load();
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
		return dailyCompleted(this.dailyState, date);
	}
	dailyInProgress(date) {
		return dailyInProgress(this.dailyState, date);
	}
	dailyAttempts(date) {
		const daily = this.dailyState;
		return daily.status === "none" || daily.date !== date ? [] : daily.attempts.map((attempt) => ({ ...attempt }));
	}
	markDailyStarted(date, track) {
		if (this.dailyInProgress(date)) return;
		const next = {
			status: "in-progress",
			date,
			dailyNumber: track.dailyNumber,
			attempts: []
		};
		this.dailyState = next;
		if (!this.storage.saveDaily(next)) this.persistenceFailed();
	}
	updateDailyAttempt(attempts) {
		if (this.dailyState.status !== "in-progress") return;
		const next = {
			...this.dailyState,
			attempts: attempts.map((attempt) => ({ ...attempt }))
		};
		this.dailyState = next;
		if (!this.storage.saveDaily(next)) this.persistenceFailed();
	}
	recordDiscovery(trackNumber) {
		if (this.discoveriesState.has(trackNumber)) return;
		const next = new Set(this.discoveriesState).add(trackNumber);
		if (!this.storage.saveDiscoveries(next)) {
			this.persistenceFailed();
			return;
		}
		this.discoveriesState = next;
	}
	resetProgress() {
		if (!this.storage.clearProgress()) return false;
		this.discoveriesState.clear();
		this.dailyState = emptyDailyProgress();
		this.bestsState = emptyPersonalBests();
		return true;
	}
	finish(run) {
		if (run.mode === "daily") {
			const nextDaily = {
				status: "completed",
				outcome: run.won ? "won" : "lost",
				date: run.dailyDate,
				dailyNumber: run.track.dailyNumber,
				attempts: run.attempts.map((attempt) => ({ ...attempt }))
			};
			this.dailyState = nextDaily;
			if (!this.storage.saveDaily(nextDaily)) this.persistenceFailed();
			return {
				mode: "daily",
				won: run.won,
				trackTitle: run.track.title,
				spotify: run.track.spotify,
				attempts: run.attempts.length
			};
		}
		if (run.mode === "classic") {
			const nextBests = cloneBests(this.bestsState);
			const update = updateClassicBest(nextBests, run.won, run.attempt);
			if (update.changed) {
				this.saveBests(nextBests);
				this.bestsState = nextBests;
			}
			const best = this.bestsState.classic;
			return {
				mode: "classic",
				won: run.won,
				trackTitle: run.track.title,
				spotify: run.track.spotify,
				newPersonalBest: update.newPersonalBest,
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
		if (run.mode === "gauntlet") {
			const elapsedMs = Math.floor(run.elapsedMs / 1e3) * 1e3;
			const completedTracks = run.completedTrackCount;
			const catalogTrackCount = run.catalogTrackCount;
			const completed = run.won && catalogTrackCount > 0 && completedTracks >= catalogTrackCount;
			const nextBests = cloneBests(this.bestsState);
			const update = updateGauntletBest(nextBests, completed, elapsedMs, catalogTrackCount);
			const bestPersisted = !update.changed || this.saveBests(nextBests);
			if (update.changed && bestPersisted) this.bestsState = nextBests;
			return {
				mode: "gauntlet",
				won: completed,
				newPersonalBest: update.newPersonalBest && bestPersisted,
				elapsedMs,
				completedTracks,
				catalogTrackCount,
				bestElapsedMs: this.bestsState.gauntlet.timeMs,
				bestTrackCount: this.bestsState.gauntlet.trackCount
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
		if (this.storage.savePersonalBests(next)) return true;
		return this.persistenceFailed();
	}
	persistenceFailed() {
		this.options.onPersistenceFailure?.();
		return false;
	}
};
function cloneDaily(progress) {
	return progress.status === "none" ? progress : {
		...progress,
		attempts: progress.attempts.map((attempt) => ({ ...attempt }))
	};
}
function cloneBests(bests) {
	return {
		classic: { ...bests.classic },
		blitz: { ...bests.blitz },
		survival: { ...bests.survival },
		gauntlet: { ...bests.gauntlet }
	};
}
function trackAssetNumber(dailyNumber) {
	return String(dailyNumber).padStart(2, "0");
}
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
	active = false;
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
		this.active = true;
		this.currentDate = dailyDate(new Date(this.runtime.now()));
		this.scheduleNextBoundary();
		return this.currentDate;
	}
	startCountdown(onTick) {
		this.countdownTick = onTick;
		if (!this.active) return;
		if (!this.nextBoundaryAt) this.scheduleNextBoundary();
		this.emitCountdown();
	}
	stopCountdown() {
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
		if (this.active) {
			this.scheduleNextBoundary();
			if (this.countdownTick) this.emitCountdown();
		}
		return date;
	}
	stop() {
		this.active = false;
		if (this.boundaryTimer) this.runtime.clearTimeout(this.boundaryTimer);
		this.boundaryTimer = 0;
		this.nextBoundaryAt = 0;
		this.stopCountdown();
	}
	scheduleNextBoundary() {
		if (!this.active) return;
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
		if (!this.active || !this.countdownTick) return;
		if (this.countdownTimer) this.runtime.clearTimeout(this.countdownTimer);
		this.countdownTimer = 0;
		const remainingMs = Math.max(0, this.nextBoundaryAt - this.runtime.now());
		this.countdownTick(remainingMs);
		if (!remainingMs) return;
		const untilNextSecond = remainingMs % 1e3 || 1e3;
		this.countdownTimer = this.runtime.setTimeout(() => this.emitCountdown(), untilNextSecond);
	}
};
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
function browserStorage() {
	try {
		return window.localStorage;
	} catch {
		return null;
	}
}
var JsonStorage = class {
	storage;
	constructor(storage) {
		this.storage = storage;
	}
	read(key) {
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
	remove(key) {
		return this.removeMany([key]);
	}
	removeMany(keys) {
		try {
			if (!this.storage) return false;
			for (const key of keys) this.storage.removeItem(key);
			return true;
		} catch {
			return false;
		}
	}
};
var storageKeys = {
	discoveries: "corzaguessr:discoveries",
	daily: "corzaguessr:daily",
	personalBests: "corzaguessr:personal-bests"
};
function parseDailyProgress(value) {
	if (!isRecord(value) || typeof value.status !== "string") return emptyDailyProgress();
	if (value.status === "none") return emptyDailyProgress();
	const completed = value.status === "completed";
	const currentKeys = completed ? [
		"status",
		"outcome",
		"date",
		"dailyNumber",
		"attempts"
	] : [
		"status",
		"date",
		"dailyNumber",
		"attempts"
	];
	if (value.status !== "in-progress" && !completed || !hasExactKeys(value, currentKeys)) return emptyDailyProgress();
	if (typeof value.date !== "string" || !isIsoDate(value.date) || !isPositiveInteger(value.dailyNumber) || !Array.isArray(value.attempts) || completed && value.outcome !== "won" && value.outcome !== "lost" || completed && !isIntegerBetween(value.attempts.length, 1, 6) || !completed && !isIntegerBetween(value.attempts.length, 0, 5)) return emptyDailyProgress();
	const attemptCount = value.attempts.length;
	const attempts = [];
	for (let index = 0; index < attemptCount; index += 1) {
		const candidate = value.attempts[index];
		if (!isRecord(candidate) || !hasExactKeys(candidate, [
			"id",
			"outcome",
			"trackNumber"
		])) return emptyDailyProgress();
		const expectedId = attemptCount - index;
		const validOutcome = completed && index === 0 ? value.outcome === "won" && candidate.outcome === "correct" || value.outcome === "lost" && (candidate.outcome === "wrong" || candidate.outcome === "skip") : candidate.outcome === "wrong" || candidate.outcome === "skip";
		const validTrack = candidate.outcome === "skip" ? candidate.trackNumber === null : isPositiveInteger(candidate.trackNumber);
		if (candidate.id !== expectedId || !validOutcome || !validTrack) return emptyDailyProgress();
		attempts.push({
			id: candidate.id,
			outcome: candidate.outcome,
			trackNumber: candidate.trackNumber
		});
	}
	const common = {
		date: value.date,
		dailyNumber: value.dailyNumber,
		attempts
	};
	return completed ? {
		status: "completed",
		outcome: value.outcome,
		...common
	} : {
		status: "in-progress",
		...common
	};
}
function parsePersonalBests(value) {
	if (!isRecord(value) || !hasExactKeys(value, [
		"classic",
		"blitz",
		"survival",
		"gauntlet"
	])) return emptyPersonalBests();
	const { classic, blitz, survival, gauntlet } = value;
	if (!isRecord(classic) || !hasExactKeys(classic, [
		"current",
		"best",
		"snippetTotal",
		"bestSnippetTotal"
	]) || !isNonNegativeInteger(classic.current) || !isNonNegativeInteger(classic.best) || !isNonNegativeInteger(classic.snippetTotal) || !isNonNegativeInteger(classic.bestSnippetTotal) || classic.best < classic.current || !validSnippetTotal(classic.current, classic.snippetTotal) || !validSnippetTotal(classic.best, classic.bestSnippetTotal) || classic.current === classic.best && classic.bestSnippetTotal > classic.snippetTotal || !validScoreBest(blitz, false) || !validScoreBest(survival, true) || !validGauntletBest(gauntlet)) return emptyPersonalBests();
	return {
		classic: {
			current: classic.current,
			best: classic.best,
			snippetTotal: classic.snippetTotal,
			bestSnippetTotal: classic.bestSnippetTotal
		},
		blitz: {
			score: blitz.score,
			accuracy: blitz.accuracy
		},
		survival: {
			score: survival.score,
			accuracy: survival.accuracy
		},
		gauntlet: {
			timeMs: gauntlet.timeMs,
			trackCount: gauntlet.trackCount
		}
	};
}
function validGauntletBest(value) {
	if (!isRecord(value) || !hasExactKeys(value, ["timeMs", "trackCount"]) || !isNonNegativeInteger(value.timeMs) || value.timeMs % 1e3 !== 0 || !isNonNegativeInteger(value.trackCount)) return false;
	return value.trackCount === 0 ? value.timeMs === 0 : true;
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
var ProgressStorage = class {
	storage;
	constructor(storage = browserStorage()) {
		this.storage = new JsonStorage(storage);
	}
	load() {
		return {
			discoveries: parseDiscoveries(this.storage.read(storageKeys.discoveries)),
			daily: parseDailyProgress(this.storage.read(storageKeys.daily)),
			personalBests: parsePersonalBests(this.storage.read(storageKeys.personalBests))
		};
	}
	saveDiscoveries(discoveries) {
		const values = [...discoveries].sort((left, right) => left - right);
		return values.length ? this.storage.write(storageKeys.discoveries, values) : this.storage.remove(storageKeys.discoveries);
	}
	clearProgress() {
		return this.storage.removeMany(Object.values(storageKeys));
	}
	saveDaily(progress) {
		return this.storage.write(storageKeys.daily, progress);
	}
	savePersonalBests(bests) {
		return this.storage.write(storageKeys.personalBests, bests);
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
var volumeStorageKey = "corzaguessr:volume";
var VolumeSettings = class {
	storage;
	constructor(storage = browserStorage()) {
		this.storage = new JsonStorage(storage);
	}
	load() {
		const value = this.storage.read(volumeStorageKey);
		return isVolume(value) ? value : 100;
	}
	save(volume) {
		if (!isVolume(volume)) return false;
		return this.storage.write(volumeStorageKey, volume);
	}
};
function isVolume(value) {
	return Number.isSafeInteger(value) && Number(value) >= 0 && Number(value) <= 100;
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
	activity = "idle";
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
		this.activity = "idle";
		if (previous && previous !== slot) {
			this.lastPrimarySlotId = previous.id;
			this.releaseSlot(previous);
		}
		return true;
	}
	playPrimary(round, restart) {
		const slot = this.primarySlot;
		if (!slot || slot.round?.id !== round.id || slot.failed || this.suspension) return false;
		const operation = { id: ++this.nextOperationId };
		slot.hasRequestedPlayback = true;
		this.operation = operation;
		if (restart) {
			slot.element.pause();
			this.seek(slot);
		} else this.correctLateSeek(slot);
		this.activity = "starting";
		let playPromise;
		try {
			playPromise = slot.element.play();
		} catch {
			if (this.isCurrentPlaybackOperation(slot, operation)) this.fail(slot, "primary", "primary-play");
			return false;
		}
		if (this.isCurrentPlaybackOperation(slot, operation)) this.startPlaybackWatchdog(slot, operation);
		playPromise?.catch((error) => {
			if (!this.isCurrentPlaybackOperation(slot, operation)) return;
			if (isNamedError(error, "AbortError")) return;
			if (isNamedError(error, "NotAllowedError")) {
				this.cancelPlaybackWatchdog(operation);
				this.operation = null;
				this.activity = "idle";
				this.callbacks.onBlocked(round);
				return;
			}
			this.fail(slot, "primary", "primary-play");
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
		this.activity = "idle";
		return true;
	}
	pause() {
		this.cancelPlaybackWatchdog();
		this.operation = null;
		const primary = this.primarySlot;
		if (!primary) return;
		this.activity = "idle";
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
		this.activity = "idle";
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
		this.activity = "idle";
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
		if (this.primarySlot) this.activity = "idle";
	}
	restore() {
		const suspension = this.suspension;
		this.suspension = null;
		if (!suspension) return;
		for (const failure of suspension.preloadFailures) this.callbacks.onFailure(failure);
		if (suspension.primaryFailure) this.callbacks.onFailure(suspension.primaryFailure);
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
		if (channel === "primary") {
			this.primarySlot = slot;
			this.activity = "idle";
		} else this.preloadSlot = slot;
		this.bind(slot);
		slot.element.preload = "auto";
		slot.element.src = this.sourceForRound(round);
		slot.element.load();
		if (slot.element.error) {
			this.fail(slot, channel, channel === "primary" ? "primary-load" : "preload-load");
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
			this.cancelPlaybackWatchdog(this.operation);
			this.activity = "playing";
			this.markReady(slot);
			this.callbacks.onPlaying(round);
		}, { signal: controller.signal });
		slot.element.addEventListener("timeupdate", () => {
			if (!live() || slot !== this.primarySlot || !this.operation || this.suspension) return;
			this.correctLateSeek(slot);
		}, { signal: controller.signal });
		const wait = () => {
			if (!live() || slot !== this.primarySlot || this.suspension) return;
			if (!this.operation || !this.isCurrentPlaybackOperation(slot, this.operation)) return;
			const wasPlaying = this.activity === "playing";
			if (this.activity === "buffering") return;
			this.activity = "buffering";
			if (wasPlaying) this.startPlaybackWatchdog(slot, this.operation);
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
			this.activity = "idle";
			this.callbacks.onEnded(round);
		}, { signal: controller.signal });
		slot.element.addEventListener("error", () => {
			if (!live() || !slot.element.error) return;
			const currentChannel = slot === this.preloadSlot ? "preload" : "primary";
			const stage = currentChannel === "preload" ? "preload-load" : slot.hasRequestedPlayback ? "primary-play" : "primary-load";
			this.fail(slot, currentChannel, stage);
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
	fail(slot, channel, stage) {
		if (slot.failed || !slot.round) return;
		slot.failed = true;
		const failure = {
			channel,
			stage,
			round: slot.round
		};
		if (channel === "preload") {
			if (this.preloadSlot === slot) this.preloadSlot = null;
			this.releaseSlot(slot);
			this.emitFailure(failure);
			return;
		}
		this.cancelPlaybackWatchdog();
		this.operation = null;
		this.activity = "idle";
		this.emitFailure(failure);
	}
	emitFailure(failure) {
		if (!this.suspension) {
			this.callbacks.onFailure(failure);
			return;
		}
		if (failure.channel === "preload") this.suspension.preloadFailures.push(failure);
		else this.suspension.primaryFailure = failure;
	}
	startPlaybackWatchdog(slot, operation) {
		this.cancelPlaybackWatchdog();
		this.watchdogTimer = this.timing.setTimeout(() => {
			if (!this.isCurrentPlaybackOperation(slot, operation) || !["starting", "buffering"].includes(this.activity)) return;
			this.watchdogTimer = 0;
			this.fail(slot, "primary", "primary-play");
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
var browserScheduler = {
	setTimeout: (callback, delayMs) => window.setTimeout(callback, delayMs),
	clearTimeout: (handle) => window.clearTimeout(handle),
	queueMicrotask: (callback) => globalThis.queueMicrotask(callback)
};
var maximumAutomaticRecoveries = 2;
var maximumNextRecoveries = 2;
var Playback = class {
	audio;
	callbacks;
	scheduler;
	loadingGraceMs;
	current = null;
	next = null;
	mode = null;
	factory = null;
	previousTrackId = null;
	failedTrackIds = /* @__PURE__ */ new Set();
	currentRecoveryFailures = 0;
	nextRecoveryFailures = 0;
	manualRetryRequired = false;
	suspended = false;
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
		return this.current?.round ?? null;
	}
	get snapshot() {
		const primary = this.current ? this.audio.primaryStatus(this.current.round) : null;
		return {
			pendingRoundId: this.current?.phase === "pending" ? this.current.round.id : null,
			activeRoundId: this.current?.phase === "active" ? this.current.round.id : null,
			playRequested: primary?.playRequested ?? false,
			retryNeeded: this.manualRetryRequired,
			loading: this.loadingVisible
		};
	}
	configure(mode, factory) {
		const changingMode = this.mode !== mode;
		this.stop();
		this.mode = mode;
		this.factory = factory;
		if (changingMode) this.previousTrackId = null;
		this.failedTrackIds.clear();
		this.resetRecoveryCircuits();
	}
	prime() {
		if (!this.mode || !this.factory || this.suspended || this.current || this.next) return;
		const round = this.factory(this.failedTrackIds, this.previousTrackId);
		if (!round) return;
		this.current = {
			phase: "prepared",
			round
		};
		if (!this.audio.loadPrimary(round) && this.isCurrent(round, "prepared")) this.handleRejected(round, "primary-load");
	}
	start(manualRetry = false) {
		if (!this.mode || !this.factory || this.suspended) return false;
		if (manualRetry) {
			this.resetRecoveryCircuits();
			this.manualRetryRequired = false;
			if (this.current?.phase !== "retry") this.failedTrackIds.clear();
		}
		if (!manualRetry && this.manualRetryRequired) {
			this.callbacks.onRecovery("manual-retry");
			return false;
		}
		let round = null;
		if (this.current?.phase === "retry") {
			round = this.current.round;
			this.current = {
				phase: "prepared",
				round
			};
			if (!this.audio.loadPrimary(round)) {
				if (this.isCurrent(round, "prepared")) this.handleRejected(round, "primary-load");
				return false;
			}
		} else if (this.current?.phase === "prepared") round = this.current.round;
		else if (this.next) {
			round = this.next;
			if (!this.audio.promotePreload(round)) {
				this.next = null;
				this.handleCurrentFailure(round, "preload-promotion", true);
				return false;
			}
			this.next = null;
		} else {
			round = this.factory(this.failedTrackIds, this.previousTrackId);
			if (!round) {
				this.manualRetryRequired = true;
				this.callbacks.onRecovery("manual-retry");
				return false;
			}
			this.current = {
				phase: "prepared",
				round
			};
			if (!this.audio.loadPrimary(round)) {
				if (this.isCurrent(round, "prepared")) this.handleRejected(round, "primary-load");
				return false;
			}
		}
		this.current = {
			phase: "pending",
			round
		};
		const operation = ++this.operationGeneration;
		this.cancelLoadingTimerOnly();
		if (!this.audio.playPrimary(round, false)) {
			if (this.isCurrent(round, "pending")) this.handleRejected(round, "primary-play");
			return false;
		}
		if (!this.isCurrent(round, "pending") || operation !== this.operationGeneration) return true;
		this.clearLoading();
		this.callbacks.onPending(round);
		this.beginLoadingNotice(round, operation);
		if (this.audio.primaryStatus(round)?.ready) this.prefetch();
		return true;
	}
	replay(round, restart) {
		if (this.suspended || !this.owns(round)) return false;
		const operation = ++this.operationGeneration;
		this.cancelLoadingTimerOnly();
		if (!this.audio.playPrimary(round, restart)) {
			if (this.owns(round)) this.handleRejected(round, "primary-play");
			return false;
		}
		if (operation !== this.operationGeneration || !this.owns(round)) return true;
		this.clearLoading();
		this.beginLoadingNotice(round, operation);
		if (this.audio.primaryStatus(round)?.ready) this.prefetch();
		return true;
	}
	rewind(round) {
		if (this.suspended || !this.owns(round)) return false;
		this.operationGeneration += 1;
		this.clearLoading();
		return this.audio.rewindPrimary(round);
	}
	pause() {
		this.operationGeneration += 1;
		this.clearLoading();
		this.audio.pause();
	}
	suspend() {
		if (this.suspended) return;
		this.suspended = true;
		this.operationGeneration += 1;
		this.clearLoading();
		this.audio.suspend();
	}
	restore() {
		if (!this.suspended) return;
		this.suspended = false;
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
		this.current = null;
		this.next = null;
		this.manualRetryRequired = false;
		this.suspended = false;
	}
	reset() {
		this.stop();
		this.mode = null;
		this.factory = null;
		this.previousTrackId = null;
		this.failedTrackIds.clear();
		this.resetRecoveryCircuits();
	}
	handleReady(event) {
		if (this.suspended) return;
		if (event.channel === "primary") {
			if (!this.owns(event.round)) return;
			this.prefetch();
			return;
		}
		if (this.next?.id !== event.round.id) return;
		this.nextRecoveryFailures = 0;
	}
	handlePlaying(round) {
		if (this.suspended) return;
		if (this.isCurrent(round, "pending")) {
			this.current = {
				phase: "active",
				round
			};
			this.manualRetryRequired = false;
			this.previousTrackId = this.mode === "daily" ? this.previousTrackId : round.track.dailyNumber;
			if (this.mode === "gauntlet") this.failedTrackIds.clear();
			this.resetCurrentRecovery();
			this.clearLoading();
			this.callbacks.onPlaying(round, true);
			this.prefetch();
			return;
		}
		if (this.isCurrent(round, "active")) {
			this.resetCurrentRecovery();
			this.clearLoading();
			this.callbacks.onPlaying(round, false);
			this.prefetch();
		}
	}
	handleWaiting(round) {
		if (this.suspended || !this.owns(round)) return;
		if (this.loadingOwner?.roundId !== round.id || this.loadingOwner.generation !== this.operationGeneration) this.beginLoadingNotice(round, this.operationGeneration);
		this.callbacks.onWaiting(round);
	}
	handleBlocked(round) {
		if (this.suspended || !this.owns(round)) return;
		this.clearLoading();
		this.callbacks.onBlocked(round);
	}
	handleEnded(round) {
		if (this.suspended || !this.isCurrent(round, "active")) return;
		this.clearLoading();
		this.callbacks.onEnded(round);
	}
	handleFailure(failure) {
		if (this.suspended) return;
		if (failure.channel === "preload") {
			if (this.next?.id !== failure.round.id) return;
			this.next = null;
			if (this.mode && modeRules[this.mode].failurePolicy !== "fixed") this.failedTrackIds.add(failure.round.track.dailyNumber);
			this.nextRecoveryFailures += 1;
			if (this.nextRecoveryFailures <= maximumNextRecoveries) this.defer(() => this.prefetch());
			return;
		}
		if (!this.owns(failure.round)) return;
		this.handleCurrentFailure(failure.round, failure.stage, false, this.restoringFromSuspension);
	}
	handleCurrentFailure(round, stage, promotionFailure, requireExplicitPlay = false) {
		const phase = this.current?.round.id === round.id ? this.current.phase : null;
		const wasPrepared = phase === "prepared";
		const shouldResume = promotionFailure || phase === "pending" || stage === "primary-play";
		const failurePolicy = this.mode ? modeRules[this.mode].failurePolicy : "replace";
		const preserveIdentity = failurePolicy === "fixed" || failurePolicy === "heard-fixed" && phase === "active";
		this.operationGeneration += 1;
		this.clearLoading();
		if (failurePolicy !== "fixed") this.failedTrackIds.add(round.track.dailyNumber);
		this.current = null;
		this.audio.releasePrimary();
		if (requireExplicitPlay) {
			this.current = {
				phase: "retry",
				round
			};
			this.manualRetryRequired = true;
			this.callbacks.onRecovery("selected-track-retry");
			return;
		}
		if (!preserveIdentity) {
			this.currentRecoveryFailures += 1;
			if (this.currentRecoveryFailures <= maximumAutomaticRecoveries) {
				if (wasPrepared || !shouldResume) this.defer(() => this.prime());
				else {
					this.callbacks.onRecovery("automatic-replacement");
					this.defer(() => this.start());
				}
				return;
			}
		}
		this.current = {
			phase: "retry",
			round
		};
		this.manualRetryRequired = true;
		this.callbacks.onRecovery("selected-track-retry");
	}
	prefetch() {
		if (!isTimedMode(this.mode) || !this.factory || this.suspended || this.next || this.nextRecoveryFailures > maximumNextRecoveries) return;
		const owned = this.current?.phase !== "retry" ? this.current?.round ?? null : null;
		if (!owned || !this.audio.primaryStatus(owned)?.ready) return;
		const round = this.factory(this.failedTrackIds, owned.track.dailyNumber);
		if (!round) return;
		this.next = round;
		if (!this.audio.loadPreload(round) && this.next?.id === round.id) this.handleRejected(round, "preload-load", "preload");
	}
	owns(round) {
		return this.current?.round.id === round.id;
	}
	isCurrent(round, phase) {
		return this.current?.round.id === round.id && this.current.phase === phase;
	}
	handleRejected(round, stage, channel = "primary") {
		this.handleFailure({
			channel,
			stage,
			round
		});
	}
	resetRecoveryCircuits() {
		this.resetCurrentRecovery();
		this.nextRecoveryFailures = 0;
	}
	resetCurrentRecovery() {
		this.currentRecoveryFailures = 0;
	}
	defer(callback) {
		const lifecycle = this.lifecycleGeneration;
		this.scheduler.queueMicrotask(() => {
			if (lifecycle === this.lifecycleGeneration && !this.suspended) callback();
		});
	}
	beginLoadingNotice(round, generation) {
		this.cancelLoadingTimerOnly();
		this.loadingOwner = {
			roundId: round.id,
			generation
		};
		this.loadingTimer = this.scheduler.setTimeout(() => {
			this.loadingTimer = 0;
			const owner = this.loadingOwner;
			if (!owner || owner.roundId !== round.id || owner.generation !== generation || generation !== this.operationGeneration || !this.owns(round) || !this.audio.primaryStatus(round)?.playRequested) return;
			this.loadingVisible = true;
			this.callbacks.onLoading(true);
		}, this.loadingGraceMs);
	}
	clearLoading() {
		this.cancelLoadingTimerOnly();
		if (this.loadingVisible) {
			this.loadingVisible = false;
			this.callbacks.onLoading(false);
		}
		this.loadingOwner = null;
	}
	cancelLoadingTimerOnly() {
		if (this.loadingTimer) this.scheduler.clearTimeout(this.loadingTimer);
		this.loadingTimer = 0;
	}
};
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
	collapseTarget = null;
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
		const previousIndexes = new Map(previousSlots.map((entry, index) => [entry.key, index]));
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
			const previousTone = element.dataset.tone ?? "";
			const previousText = element.dataset.slotText ?? "";
			const wasMilestone = element.classList.contains("gauntlet-milestone");
			const changedHead = (isNew || previousText !== entry.text || previousTone !== entry.tone || wasMilestone !== entry.gauntletMilestone) && previousIndexes.get(entry.key) === 0;
			this.applyTone(element, previousTone, entry.tone);
			element.dataset.slotText = entry.text;
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
		this.startCollapse(this.elements.container, [...this.elements.list.children], this.durations.collapse(), () => {
			const pending = this.pendingSnapshot;
			this.pendingSnapshot = null;
			this.clearRenderedSlots();
			if (pending) this.applySnapshot(pending, pending.slots.length > 0);
		});
	}
	revealAttempts() {
		const container = this.elements.container;
		const duration = this.durations.collapse();
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
		const finish = () => {
			if (generation !== this.renderGeneration) return;
			this.cancelCollapse(false);
			container.style.height = "";
		};
		this.collapseTarget = container;
		this.collapseListener = (event) => {
			const transition = event;
			if (event.target === container && (!transition.propertyName || transition.propertyName === "height")) finish();
		};
		container.addEventListener("transitionend", this.collapseListener);
		this.collapseTimer = this.scheduler.setTimer(finish, duration);
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
	cancelCollapse(resetHeight = true) {
		if (this.collapseTimer) this.scheduler.clearTimer(this.collapseTimer);
		this.collapseTimer = 0;
		if (this.collapseListener && this.collapseTarget) this.collapseTarget.removeEventListener("transitionend", this.collapseListener);
		this.collapseListener = null;
		if (resetHeight && this.collapseTarget) this.collapseTarget.style.height = "";
		this.collapseTarget = null;
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
		element.dataset.tone = next;
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
	unavailable = /* @__PURE__ */ new Set();
	suggestions = [];
	selectedIndex = -1;
	unavailableSignature = "";
	suspended = false;
	constructor(input, list, onGuess, onPlaybackShortcut) {
		this.input = input;
		this.list = list;
		this.onGuess = onGuess;
		this.onPlaybackShortcut = onPlaybackShortcut;
		input.addEventListener("input", () => {
			if (!this.suspended) this.update();
		});
		input.addEventListener("keydown", (event) => this.handleKeydown(event));
		list.addEventListener("pointerover", (event) => {
			if (this.suspended) return;
			const option = event.target instanceof Element ? event.target.closest("[role=option]") : null;
			if (!option) return;
			const index = [...this.list.children].indexOf(option);
			if (index >= 0) this.select(index);
		});
		list.addEventListener("click", (event) => {
			if (this.suspended) return;
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
		if (this.input.value.trim() && !this.suspended) this.update(selectedId);
	}
	setSuspended(suspended) {
		if (suspended === this.suspended) return;
		this.suspended = suspended;
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
		if (this.suspended) {
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
var months = [
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
	const monthName = month ? months[Number(month) - 1] : void 0;
	if (!year || !monthName || !day) return value;
	const numericDay = Number(day);
	const remainder = numericDay % 100;
	return `${monthName} ${numericDay}${remainder >= 11 && remainder <= 13 ? "TH" : numericDay % 10 === 1 ? "ST" : numericDay % 10 === 2 ? "ND" : numericDay % 10 === 3 ? "RD" : "TH"}, ${year}`;
}
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
			gauntlet.tabIndex = -1;
			gauntlet.setAttribute("aria-label", "START GAUNTLET");
			gauntlet.addEventListener("pointerdown", (event) => event.preventDefault());
			gauntlet.addEventListener("focus", () => gauntlet.blur());
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
var modes = [
	"daily",
	"classic",
	"blitz",
	"survival"
];
function nextPrimaryFocus(state, key) {
	const modeIndex = state.current && isMode(state.current) ? modes.indexOf(state.current) : -1;
	if (modeIndex >= 0) {
		if (key === "ArrowUp") return available(state, "discovery");
		if (key === "ArrowDown") return available(state, "play");
		return modeInDirection(state, modeIndex, key === "ArrowLeft" ? -1 : 1);
	}
	const recommended = recommendedMode(state);
	if (state.current === "discovery") {
		if (key === "ArrowDown") return recommended;
		if (key === "ArrowLeft") return modes.find((mode) => state.enabled.has(mode)) ?? null;
		if (key === "ArrowRight") return [...modes].reverse().find((mode) => state.enabled.has(mode)) ?? null;
		return null;
	}
	if (state.current === "play") return key === "ArrowUp" ? recommended : null;
	return state.selectedMode && state.enabled.has("play") ? "play" : recommended;
}
function recommendedMode(state) {
	if (state.completedDaily && state.enabled.has("classic")) return "classic";
	if (!state.selectedMode && state.enabled.has("daily")) return "daily";
	const selectedIndex = state.selectedMode ? modes.findIndex((mode) => mode === state.selectedMode) : -1;
	if (selectedIndex < 0) return modes.find((mode) => state.enabled.has(mode)) ?? null;
	for (let distance = 1; distance < modes.length; distance += 1) {
		const right = modes[selectedIndex + distance];
		if (right && state.enabled.has(right)) return right;
		const left = modes[selectedIndex - distance];
		if (left && state.enabled.has(left)) return left;
	}
	return modes.find((mode) => state.enabled.has(mode)) ?? null;
}
function modeInDirection(state, start, step) {
	for (let distance = 1; distance < modes.length; distance += 1) {
		const mode = modes[(start + step * distance + modes.length) % modes.length];
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
	lockedScroll = null;
	constructor(root, elements, durations, reducedMotion, announce, scheduler = browserAnimationScheduler) {
		this.root = root;
		this.elements = elements;
		this.durations = durations;
		this.reducedMotion = reducedMotion;
		this.announce = announce;
		this.scheduler = scheduler;
	}
	get discoveryLayoutActive() {
		return this.kind === "discovery" && !this.closing;
	}
	openResult() {
		if (this.kind) return;
		this.kind = "result";
		this.captureReturnFocus();
		this.lockScroll();
		this.elements.card.classList.add("result-open");
		this.elements.result.setAttribute("aria-hidden", "false");
		this.elements.resultAction.focus({ preventScroll: true });
		this.announce(this.elements.resultMeta.dataset.announcement || "RESULT");
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
	closeResult(fallbackFocus) {
		if (this.kind !== "result") return;
		this.elements.card.classList.remove("result-open");
		this.elements.result.setAttribute("aria-hidden", "true");
		this.kind = null;
		this.closing = false;
		this.unlockScroll();
		this.returnFocus = null;
		if (this.canFocus(fallbackFocus)) fallbackFocus.focus({ preventScroll: true });
	}
	closeDiscovery(fallbackFocus, onClosed, focusOverride = null) {
		if (this.closing || this.kind !== "discovery") return false;
		this.closing = true;
		const generation = ++this.transitionGeneration;
		this.scheduler.cancelFrame(this.openFrame);
		this.openFrame = 0;
		this.cancelCloseWait();
		this.root.classList.remove("discovery-visible");
		this.elements.discoveryShell.style.height = `${this.elements.discoveryShell.offsetHeight}px`;
		this.elements.discoveryShell.offsetHeight;
		this.elements.discoveryShell.style.height = "0px";
		this.elements.discoveryButton.setAttribute("aria-expanded", "false");
		const finish = () => {
			if (this.kind !== "discovery" || this.transitionGeneration !== generation) return;
			this.cancelCloseWait();
			this.root.classList.remove("discovery-open", "discovery-visible");
			this.elements.discoveryModal.setAttribute("aria-hidden", "true");
			this.elements.discoveryShell.style.height = "";
			this.elements.discoveryShell.style.transition = "";
			this.elements.discoveryClose.style.visibility = "";
			this.kind = null;
			this.closing = false;
			this.unlockScroll();
			onClosed();
			const preferred = this.returnFocus;
			this.returnFocus = null;
			const target = focusOverride && this.canFocus(focusOverride) ? focusOverride : preferred && this.canFocus(preferred) ? preferred : fallbackFocus;
			if (this.canFocus(target)) target.focus({ preventScroll: true });
		};
		if (this.reducedMotion.matches) {
			finish();
			return true;
		}
		const transitionTarget = this.elements.discoveryShell;
		this.closeListener = (event) => {
			const transition = event;
			if (event.target === transitionTarget && (!transition.propertyName || transition.propertyName === "height")) finish();
		};
		transitionTarget.addEventListener("transitionend", this.closeListener);
		this.closeTimer = this.scheduler.setTimer(finish, this.durations.discovery);
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
		if (this.closeListener) this.elements.discoveryShell.removeEventListener("transitionend", this.closeListener);
		this.closeListener = null;
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
		this.container.classList.toggle("has-gauntlet-best", bests.gauntlet.trackCount > 0);
		this.container.replaceChildren(...summaryRows.map((row) => {
			const item = document.createElement("div");
			item.className = "progress-best";
			if (row.mode === "GAUNTLET") item.classList.add("progress-best-gauntlet");
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
			value: dailyComplete ? dailyWon(daily, dailyDate) ? `${dailyAttempt(daily) + 1}/6` : "FAILED" : emptyRecordValue,
			detail: dailyComplete ? formatOrdinalDate(daily.date) : emptyRecordDetail
		},
		{
			mode: "CLASSIC",
			value: bests.classic.best ? `${bests.classic.best}-GAME STREAK` : emptyRecordValue,
			detail: bests.classic.best ? `AVERAGE ${formatDecimal(classicAverage)}s` : emptyRecordDetail
		},
		{
			mode: "BLITZ",
			value: bests.blitz.score ? `${bests.blitz.score} CORRECT` : emptyRecordValue,
			detail: bests.blitz.score ? `${bests.blitz.accuracy ?? 0}% ACCURACY` : emptyRecordDetail
		},
		{
			mode: "SURVIVAL",
			value: bests.survival.score ? `${formatClock(bests.survival.score / 1e3)} SURVIVED` : emptyRecordValue,
			detail: bests.survival.score ? `${bests.survival.accuracy ?? 0}% ACCURACY` : emptyRecordDetail
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
function createResultRow(row, newPersonalBest) {
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
var TimelineView = class {
	elements;
	durations;
	reducedMotion;
	scheduler;
	motionGeneration = 0;
	progressTimer = 0;
	progressListener = null;
	survivalTimer = 0;
	survivalListener = null;
	survivalGeneration = 0;
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
		this.elements.fill.offsetWidth;
		this.elements.fill.style.transition = "transform var(--duration-timeline-reset) ease-out";
		this.waitForProgressMotion("transitionend", this.elements.fill, this.durations.reset, generation, (event) => {
			const transition = event;
			return !transition.propertyName || transition.propertyName === "transform";
		});
	}
	flashSurvivalChange(seconds) {
		if (!seconds) return;
		this.clearSurvivalFeedback();
		this.elements.timeChangeText.textContent = seconds > 0 ? `+${seconds}S` : `${seconds}S`;
		if (this.durations.survivalFeedback <= 0) {
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
		this.survivalTimer = this.scheduler.setTimer(finish, this.durations.survivalFeedback);
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
		this.container.dataset.volume = String(volume);
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
	durations;
	handlers = null;
	state = null;
	sessionKey = null;
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
			survivalFeedback: duration(styles, "--duration-survival-feedback"),
			shareVisible: duration(styles, "--duration-share-visible"),
			shareFade: duration(styles, "--duration-share-fade"),
			wiggle: duration(styles, "--duration-wiggle"),
			slot: duration(styles, "--duration-slot"),
			discoveryModal: duration(styles, "--duration-discovery-modal"),
			timelineReset: duration(styles, "--duration-timeline-reset"),
			timelineRewind: duration(styles, "--duration-timeline-rewind")
		};
		this.modal = new ModalController(root, this.elements, { discovery: this.durations.discoveryModal }, this.reducedMotion, (message) => this.announce(message));
		this.autocomplete = new Autocomplete(this.elements.guess, this.elements.suggest, (id) => this.handlers?.guess(id), () => this.handlers?.playbackShortcut());
		this.attempts = new AttemptHistoryView({
			container: this.required(".attempt-area"),
			list: this.elements.slots
		}, {
			slot: this.durations.slot,
			wiggle: this.durations.wiggle,
			collapse: () => this.durations.slot
		}, this.reducedMotion);
		this.timeline = new TimelineView({
			timeline: this.elements.timeline,
			now: this.elements.now,
			fill: this.elements.fill,
			feedback: this.elements.feedback,
			timeChange: this.elements.timeChange,
			timeChangeText: this.elements.timeChangeText
		}, {
			reset: this.durations.timelineReset,
			rewind: this.durations.timelineRewind,
			survivalFeedback: this.durations.survivalFeedback
		}, this.reducedMotion);
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
		this.discovery.bind(handlers.openDiscoverySpotify, handlers.startGauntlet);
		this.elements.play.addEventListener("click", handlers.play);
		this.elements.skip.addEventListener("click", handlers.skip);
		this.elements.resultAction.addEventListener("click", handlers.resultAction);
		this.elements.resultSecondary.addEventListener("click", () => {
			const action = this.state?.result?.secondary?.action;
			if (action === "share") handlers.shareDaily();
			else if (action === "spotify") handlers.openSpotify();
		});
		this.elements.discoveryButton.addEventListener("click", handlers.openDiscovery);
		this.elements.discoveryClose.addEventListener("click", handlers.closeDiscovery);
		this.elements.discoveryReset.addEventListener("click", () => this.showResetConfirmation());
		this.elements.resetCancel.addEventListener("click", () => this.hideResetConfirmation(true));
		this.elements.resetConfirm.addEventListener("click", () => {
			this.hideResetConfirmation(false);
			handlers.resetProgress();
			this.elements.discoveryClose.focus({ preventScroll: true });
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
		const previousOverlay = this.state?.overlay ?? null;
		const sessionChanged = this.sessionKey !== null && this.sessionKey !== sessionKey;
		const openingOverlay = state.overlay !== previousOverlay ? state.overlay : null;
		this.state = state;
		this.sessionKey = sessionKey;
		if (sessionChanged) this.timeline.beginReset();
		if (sessionChanged || openingOverlay) this.resetTransientUi();
		const transportVisible = state.transportText !== "";
		this.root.classList.toggle("rules-visible", !state.inputVisible || transportVisible);
		this.root.classList.toggle("timed", isTimedMode(state.mode));
		const awaiting = state.appStatus === "awaiting-mode";
		this.elements.modePrompt.setAttribute("aria-hidden", String(!awaiting));
		this.elements.play.disabled = !state.playEnabled;
		this.elements.skip.disabled = !state.attemptEnabled;
		this.elements.guess.disabled = !state.guessEnabled || transportVisible;
		this.autocomplete.setSuspended(!state.attemptEnabled || transportVisible);
		const blockedBoard = awaiting || state.appStatus === "loading";
		const overlay = state.overlay !== null;
		this.elements.headerAction.inert = overlay;
		this.elements.modes.inert = overlay;
		this.elements.board.inert = overlay;
		this.elements.slots.inert = overlay || blockedBoard;
		for (const [mode, button] of Object.entries(this.modeButtons)) {
			const selected = mode === state.mode;
			button.disabled = state.appStatus === "error" || selected || state.overlay === "discovery";
			button.setAttribute("aria-pressed", String(selected));
		}
		this.elements.icon.setAttribute("d", icons[state.playbackIcon]);
		this.elements.play.setAttribute("aria-label", state.playbackIcon === "play" ? "PLAY" : state.playbackIcon === "pause" ? "PAUSE" : "STOP");
		this.elements.skip.textContent = state.skipText;
		this.elements.snippet.style.width = `${state.snippetSeconds / snippetDurations.at(-1) * 100}%`;
		this.renderRules();
		this.attempts.render(state.slots, sessionKey);
		this.autocomplete.setDependencies(state.tracks, state.unavailableGuessIds);
		if (state.overlay === "discovery") {
			this.renderDiscovery(state);
			this.progressSummary.render(state.personalBests, state.dailyProgress, state.dailyDate);
		}
		this.renderResult(state.result);
		this.renderClock(state.clock);
		if (openingOverlay === "result") this.modal.openResult();
		else if (openingOverlay === "discovery") {
			this.hideResetConfirmation(false);
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
		this.timeline.flashSurvivalChange(seconds);
	}
	closeResult(focus) {
		const target = focus === "classic" ? this.modeButtons.classic : this.elements.play;
		this.modal.closeResult(target);
	}
	beginDiscoveryClose(request) {
		return this.modal.closeDiscovery(this.elements.discoveryButton, () => queueMicrotask(() => {
			this.handlers?.discoveryClosed(request);
			this.focusAfterDiscoveryClose(request);
		}));
	}
	showDailyShareCopied() {
		if (this.state?.overlay !== "result" || this.state.result?.secondary?.action !== "share") return;
		if (this.resultCopyFeedbackTimer) window.clearTimeout(this.resultCopyFeedbackTimer);
		const generation = ++this.resultCopyFeedbackGeneration;
		this.elements.resultSecondaryLabel.classList.remove("fading");
		this.elements.resultSecondaryLabel.textContent = "COPIED";
		this.resultCopyFeedbackTimer = window.setTimeout(() => {
			this.resultCopyFeedbackTimer = 0;
			if (this.state?.overlay === "result" && this.state.result?.secondary?.action === "share") this.swapResultSecondaryLabel("SHARE", generation);
		}, this.durations.shareVisible);
	}
	resetTransientUi() {
		cancelAnimationFrame(this.announcementFrame);
		this.elements.status.textContent = "";
		this.timeline.clearSurvivalFeedback();
		this.preview = null;
		this.autocomplete.reset();
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
	focusAfterDiscoveryClose(request) {
		if (request.outcome === "start-gauntlet" || this.state?.mode) this.focusPlay();
		else this.focusIfAvailable(this.elements.discoveryButton);
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
	showResetConfirmation() {
		if (this.resetConfirmationOpen) return;
		this.elements.discoveryActions.hidden = true;
		this.elements.resetConfirmation.hidden = false;
		this.elements.resetCancel.focus({ preventScroll: true });
	}
	hideResetConfirmation(returnFocus) {
		if (!this.resetConfirmationOpen) return;
		this.elements.resetConfirmation.hidden = true;
		this.elements.discoveryActions.hidden = false;
		if (returnFocus) this.elements.discoveryReset.focus({ preventScroll: true });
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
		this.elements.resultAction.textContent = result.primaryLabel;
		this.elements.resultTitle.innerHTML = result.titleHtml;
		this.elements.resultMeta.replaceChildren(...result.rows.map((row) => createResultRow(row, result.highlightPersonalBest)));
		this.elements.resultMeta.dataset.announcement = result.announcement;
		this.elements.resultSecondaryLabel.textContent = result.secondary?.label ?? "";
		if (result.secondary) this.elements.resultSecondary.setAttribute("aria-label", result.secondary.ariaLabel);
		else this.elements.resultSecondary.removeAttribute("aria-label");
		this.elements.resultSecondary.hidden = result.secondary === null;
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
		}, this.durations.shareFade);
	}
	previewAllowed() {
		return !!this.state && ["awaiting-mode", "ready"].includes(this.state.appStatus) && this.state.overlay === null && !this.state.inputVisible;
	}
	get resetConfirmationOpen() {
		return !this.elements.resetConfirmation.hidden;
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
				if (this.state.overlay === "discovery" && this.resetConfirmationOpen) this.hideResetConfirmation(true);
				else this.state.overlay === "discovery" ? this.handlers.closeDiscovery() : this.handlers.resultAction();
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
		const candidates = overlay === "result" ? [this.elements.resultAction, this.elements.resultSecondary] : this.resetConfirmationOpen ? [this.elements.resetCancel, this.elements.resetConfirm] : [this.elements.discoveryClose, this.elements.discoveryReset];
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
			slots: this.required(".slots"),
			card: this.required(".card"),
			play: this.required(".play"),
			skipRow: this.required(".skip-row"),
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
			discoveryActions: this.required(".discovery-actions"),
			resetConfirmation: this.required(".reset-confirmation"),
			resetCancel: this.required(".reset-cancel"),
			resetConfirm: this.required(".reset-confirm"),
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
function markup() {
	return [
		`<div class="wrap">`,
		`<h1>CORZAGUESSR&#10022;</h1>`,
		`<div class="row header-action"><button type="button" class="button discovery-button glass" aria-controls="corzaguessr-discovery" aria-expanded="false"><span>PROGRESS</span></button></div>
    <div class="game-surface"><div class="modes mode-navigation glass" aria-label="GAME MODE"><button type="button" class="mode" data-mode="daily" aria-pressed="false">DAILY</button><button type="button" class="mode" data-mode="classic" aria-pressed="false">CLASSIC</button><button type="button" class="mode" data-mode="blitz" aria-pressed="false">BLITZ</button><button type="button" class="mode" data-mode="survival" aria-pressed="false">SURVIVAL</button></div>`,
		`<div class="card glass">`,
		`<div class="stack">`,
		`<div class="board">`,
		`<div class="controls"><div class="time"><span class="now">0:00</span></div><button type="button" class="play" aria-label="PLAY" disabled><svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d="${icons.play}"></path></svg></button><div class="time"><span class="endtime">0:01</span></div></div>`,
		`<div class="volume-control"><div class="volume-bars" aria-hidden="true"><i class="volume-bar"></i><i class="volume-bar"></i><i class="volume-bar"></i><i class="volume-bar"></i><i class="volume-bar"></i><i class="volume-bar"></i><i class="volume-bar"></i><i class="volume-bar"></i></div><input class="volume-range" type="range" min="0" max="100" step="1" value="100" aria-label="VOLUME" aria-valuetext="100 percent"></div>`,
		`<div class="timeline"><div class="snippet"></div><div class="fill"></div><div class="feedback"></div><div class="time-change"><span></span></div><i class="tick" style="left:3.125%"></i><i class="tick" style="left:6.25%"></i><i class="tick" style="left:12.5%"></i><i class="tick" style="left:25%"></i><i class="tick" style="left:50%"></i></div>`,
		`<div class="guess-lane"><div class="auto"><label class="sr-only" for="corzaguessr-guess">SEARCH FOR A TRACK</label><input id="corzaguessr-guess" class="guess" placeholder="HAVE A GUESS? SEARCH FOR IT HERE!" autocomplete="off" role="combobox" aria-autocomplete="list" aria-controls="corzaguessr-suggestions" aria-expanded="false" disabled><div class="ruleset" aria-hidden="true"><div class="ruleset-track"><span class="ruleset-text">${copy.modePrompt}</span><span class="ruleset-copy">${copy.modePrompt}</span></div></div><div id="corzaguessr-suggestions" class="suggest" role="listbox"></div></div><div class="row skip-row"><button type="button" class="button skip" disabled>ADD 1S</button></div></div>`,
		`</div>`,
		`<div class="attempt-area"><div class="history" aria-live="polite" aria-relevant="additions text"><div class="slots"></div></div></div>`,
		`</div>`,
		`<div class="result-modal" aria-hidden="true"><div class="result-shell"><div class="corzaguessr-modal glass" role="dialog" aria-modal="true" aria-labelledby="corzaguessr-result-title" aria-describedby="corzaguessr-result-meta" tabindex="-1"><h3 id="corzaguessr-result-title" class="modal-title"></h3><div id="corzaguessr-result-meta" class="result-meta"></div><div class="actions"><button type="button" class="button result-action">NEW GAME</button><button type="button" class="button result-secondary" hidden></button></div></div></div></div>`,
		`<div id="corzaguessr-discovery" class="discovery-modal" role="dialog" aria-modal="true" aria-label="PROGRESS" aria-hidden="true" tabindex="-1"><div class="discovery-shell"><div class="discovery-panel glass"><div class="discovery-title"><span>DISCOVERY</span><small>0 / 0 (0%)</small></div><div class="discovery-items" role="list"></div><section class="progress-summary" aria-labelledby="corzaguessr-records-title"><h4 id="corzaguessr-records-title">RECORDS</h4><div class="progress-bests"></div></section><div class="actions discovery-actions"><button type="button" class="button discovery-close">CLOSE</button><button type="button" class="button discovery-reset">RESET</button></div><section class="reset-confirmation" role="group" aria-labelledby="corzaguessr-reset-title" aria-describedby="corzaguessr-reset-warning" hidden><strong id="corzaguessr-reset-title">RESET ALL PROGRESS?</strong><span id="corzaguessr-reset-warning">THIS ERASES DISCOVERY, DAILY PROGRESS, AND RECORDS.</span><div class="actions"><button type="button" class="button reset-cancel">CANCEL</button><button type="button" class="button reset-confirm">RESET</button></div></section></div></div></div>`,
		`</div>`,
		`</div>`,
		`<p class="mode-prompt" role="status" aria-hidden="false">${copy.modePrompt}</p>`,
		`</div>`,
		`<p class="sr-only status" aria-live="polite"></p>`,
		`<audio class="audio" preload="metadata" playsinline aria-hidden="true" hidden></audio>`,
		`<audio class="audio" preload="metadata" playsinline aria-hidden="true" hidden></audio>`
	].join("");
}
var jsDelivrRepositoryBaseUrl = new URL("https://cdn.jsdelivr.net/gh/HankeyThePoo/corzaguessr@main/");
var root = document.querySelector("#corzaguessr");
if (root && !root.dataset.corzaguessrReady) {
	const volumeSettings = new VolumeSettings();
	const initialVolume = volumeSettings.load();
	let volumePersistenceFailureAnnounced = false;
	const moduleUrl = new URL(import.meta.url);
	const coverBaseUrl = new URL("covers/", jsDelivrRepositoryBaseUrl);
	const view = new GameView(root, initialVolume, (dailyNumber) => {
		return new URL(`${trackAssetNumber(dailyNumber)}.webp`, coverBaseUrl).href;
	});
	const catalogUrl = new URL("tracks.json", moduleUrl);
	const audioBaseUrl = new URL("tracks/", jsDelivrRepositoryBaseUrl);
	catalogUrl.search = moduleUrl.search;
	let controller;
	let playback;
	const catalog = new Catalog(new CatalogSource(catalogUrl), {
		setTimeout: (callback, delayMs) => window.setTimeout(callback, delayMs),
		clearTimeout: (handle) => window.clearTimeout(handle)
	});
	const progress = new Progress(new ProgressStorage(), { onPersistenceFailure: () => controller?.onProgressPersistenceFailure() });
	const clock = new GameClock({
		onTick: (snapshot) => controller?.onClockTick(snapshot),
		onExpired: () => controller?.onClockExpired()
	});
	const audio = new AudioPlayer(view.audioElements, (round) => {
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
	playback = new Playback(audio, {
		onPending: (round) => controller?.onPending(round),
		onPlaying: (round, startedNewRound) => {
			controller?.onAudioPlaying(round, startedNewRound);
		},
		onWaiting: (round) => controller?.onAudioWaiting(round),
		onBlocked: (round) => controller?.onAudioBlocked(round),
		onEnded: (round) => controller?.onAudioEnded(round),
		onRecovery: (kind) => controller?.onAudioRecovery(kind),
		onLoading: (visible) => controller?.onLoading(visible)
	});
	const dailySchedule = new DailySchedule((date) => controller?.handleDailyDateChanged(date));
	controller = new GameController(catalog, progress, clock, playback, view, dailySchedule, openSpotify, copyToClipboard);
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
		startGauntlet: () => controller.startGauntlet(),
		discoveryClosed: (request) => controller.onDiscoveryClosed(request),
		setVolume: (volume, committed) => {
			audio.setVolume(volume / 100);
			if (!committed) return;
			if (!volumeSettings.save(volume) && !volumePersistenceFailureAnnounced) {
				volumePersistenceFailureAnnounced = true;
				view.announce("VOLUME PREFERENCE COULD NOT BE SAVED IN THIS BROWSER.");
			}
		}
	});
	controller.bootstrap(dailySchedule.current());
	if (document.hidden) controller.handlePageHidden();
	document.addEventListener("visibilitychange", () => {
		if (document.hidden) controller.handlePageHidden();
		else controller.handlePageVisible();
	});
	window.addEventListener("pageshow", () => {
		if (!document.hidden) controller.handlePageVisible();
	});
}
