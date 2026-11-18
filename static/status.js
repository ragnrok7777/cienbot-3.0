/* =========================================================
   CINEBOT 3.0 — STATUS BADGES AND LIVE AIRING COUNTDOWN
   Shared by index.html, universe.html, anime.html and movie.html.
   Load this file BEFORE the page's own script.
========================================================= */

// Escapes text placed inside an HTML attribute.
function cbEscape(value) {
    return String(value ?? "").replace(/[&<>"']/g, char => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#039;"
    })[char]);
}

// Anime status from AniList (also used for TV after the server converts it).
// Green = airing, red = finished or cancelled, amber = upcoming or on hiatus.
function cbStatusBadge(status) {
    const map = {
        RELEASING: { label: "Airing", cls: "status-airing" },
        FINISHED: { label: "Completed", cls: "status-finished" },
        CANCELLED: { label: "Cancelled", cls: "status-finished" },
        NOT_YET_RELEASED: { label: "Upcoming", cls: "status-upcoming" },
        HIATUS: { label: "On Hiatus", cls: "status-upcoming" }
    };

    const entry = map[status];

    if (!entry) return "";

    return `
        <span class="status-badge ${entry.cls}">
            <span class="status-dot-live"></span>
            ${entry.label}
        </span>
    `;
}

// TV status straight from TMDB (used on the TV details page).
// TMDB uses "Canceled" with one L.
function cbTvStatusBadge(status) {
    const map = {
        "Returning Series": { label: "Airing", cls: "status-airing" },
        "In Production": { label: "In Production", cls: "status-upcoming" },
        "Planned": { label: "Planned", cls: "status-upcoming" },
        "Ended": { label: "Completed", cls: "status-finished" },
        "Canceled": { label: "Cancelled", cls: "status-finished" }
    };

    const entry = map[status];

    if (!entry) return "";

    return `
        <span class="status-badge ${entry.cls}">
            <span class="status-dot-live"></span>
            ${entry.label}
        </span>
    `;
}

// Turns a number of seconds into text such as "in 5d 19h 6m" or "in 40m".
function cbCountdown(seconds) {
    if (seconds <= 0) return "airing now";

    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);

    if (days > 0) return `in ${days}d ${hours}h ${minutes}m`;
    if (hours > 0) return `in ${hours}h ${minutes}m`;

    return `in ${minutes}m`;
}

// Anime next episode from AniList. airingAt is a Unix timestamp in seconds,
// so the time is exact. The countdown and date refresh every minute.
function cbNextEpisodeLine(next) {
    if (!next || !next.airingAt) return "";

    const airAt = next.airingAt * 1000;

    // Skip episodes that aired more than a day ago. The data is out of date.
    if (airAt < Date.now() - 86400000) return "";

    const episode = Number(next.episode);

    const when = new Date(airAt).toLocaleString(undefined, {
        weekday: "short",
        day: "numeric",
        month: "short",
        year: "numeric",
        hour: "numeric",
        minute: "2-digit"
    });

    const seconds = (airAt - Date.now()) / 1000;

    return `
        <p class="next-episode"
           data-airs-at="${airAt}"
           data-episode="${cbEscape(episode)}"
           data-when="${cbEscape(when)}">
            Episode ${episode} airs ${cbCountdown(seconds)} · ${cbEscape(when)}
        </p>
    `;
}

// TV next episode from TMDB. TMDB gives only the date, not the time, so the
// countdown runs to midnight (local time) on that date.
function cbTvNextEpisodeLine(next) {
    if (!next || !next.air_date) return "";

    const airAt = new Date(`${next.air_date}T00:00:00`).getTime();

    // Ignore dates that passed more than a day ago. They are out of date.
    if (airAt < Date.now() - 86400000) return "";

    const episode = Number(next.episode_number);

    return `
        <p class="next-episode"
           data-airs-at="${airAt}"
           data-episode="${cbEscape(episode)}">
            Episode ${episode} airs ${cbCountdown((airAt - Date.now()) / 1000)}
        </p>
    `;
}

// Updates every countdown on the page. Runs once a minute.
function cbRefreshCountdowns() {
    document.querySelectorAll("[data-airs-at]").forEach(element => {
        const airAt = Number(element.dataset.airsAt);
        const episode = element.dataset.episode;
        const when = element.dataset.when;
        const seconds = (airAt - Date.now()) / 1000;

        element.textContent =
            `Episode ${episode} airs ${cbCountdown(seconds)}` +
            (when ? ` · ${when}` : "");
    });
}

setInterval(cbRefreshCountdowns, 60000);
document.addEventListener("DOMContentLoaded", cbRefreshCountdowns);